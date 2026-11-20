import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, writeFile, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createWallet } from '../commerce/wallet.mjs';
import { createArchiveDownloads, downloadPriceRaw } from '../commerce/archive-downloads.mjs';
import { handlePrivateTemplateArchive } from '../private-template-archive.mjs';

test(
  'preview, paid file authorization, owner-scoped resume, independent downloads and unused authorizations',
  { timeout: 15000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'archive-billing-'));
    const dir = join(root, 'private-template-archive');
    const bytes = Buffer.alloc(128 * 1024 + 37);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
    const item = {
      id: 'windx-1',
      name: 'QA fixture',
      file: 'windx-1.pdf',
      fileStatus: 'archived',
      originalName: 'QA.pdf',
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    const file = join(dir, 'files', item.file);
    await mkdir(join(dir, 'files'), { recursive: true });
    await writeFile(file, bytes);
    await writeFile(join(dir, 'catalog.json'), JSON.stringify({ items: [item] }));
    const db = new DatabaseSync(':memory:');
    const wallet = createWallet(db);
    let now = Date.now();
    const billing = createArchiveDownloads({ db, wallet, now: () => now });
    const origin = 'https://example.invalid';
    const server = createServer(async (req, res) => {
      const name = req.headers['x-user'] || 'employee';
      const user = { id: name, email: name + '@example.invalid', role: name };
      try {
        await handlePrivateTemplateArchive(req, res, {
          root,
          url: new URL(req.url, origin),
          user,
          config: {},
          allowedOrigins: new Set([origin]),
          archiveDownloads: billing,
          readBody: async (r) => {
            const a = [];
            for await (const c of r) a.push(c);
            return Buffer.concat(a);
          },
          purchases: {
            verifyPin: async (_u, pin) => {
              if (pin !== '123456') throw Object.assign(Error('invalid PIN'), { status: 403 });
            },
          },
        });
      } catch (error) {
        res.writeHead(500).end(String(error));
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const url = 'http://127.0.0.1:' + server.address().port;
    const base = '/__host/template-archive',
      path = base + '/files/' + item.id;
    const req = (p, opts) => fetch(url + p, opts);
    const authorize = (id, pin = '123456') =>
      req(path + '/authorize', {
        method: 'POST',
        headers: { Origin: origin, 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: id, pin }),
      });
    try {
      assert.equal((await req(base + '/catalog')).status, 200);
      assert.equal((await req(path)).status, 402);
      assert.equal((await req(path, { method: 'HEAD' })).status, 402);
      assert.equal((await req(base + '/catalog', { headers: { 'x-user': 'customer' } })).status, 403);
      assert.equal((await authorize(randomUUID())).status, 402);
      wallet.credit({ userId: 'employee', reference: 'seed', amountRaw: downloadPriceRaw * 2 });
      assert.equal((await authorize(randomUUID(), '000000')).status, 403);
      const id = randomUUID();
      const { downloadPath: ticket } = await (await authorize(id)).json();
      assert.ok(ticket);
      assert.equal((await (await authorize(id)).json()).downloadPath, ticket);
      const secondRequest = randomUUID();
      assert.equal((await (await authorize(secondRequest)).json()).downloadPath, ticket);
      assert.equal(wallet.snapshot('employee').heldRaw, downloadPriceRaw);
      assert.equal((await req(ticket, { headers: { 'x-user': 'employee2' } })).status, 403);
      assert.equal((await req(ticket, { method: 'HEAD' })).status, 200);
      assert.equal(wallet.snapshot('employee').entries.length, 1);
      const partial = await req(ticket, { headers: { Range: 'bytes=0-4' } });
      assert.equal(partial.status, 206);
      assert.deepEqual(Buffer.from(await partial.arrayBuffer()), bytes.subarray(0, 5));
      const rest = await req(ticket, { headers: { Range: 'bytes=5-' } });
      assert.equal(rest.status, 206);
      assert.deepEqual(Buffer.from(await rest.arrayBuffer()), bytes.subarray(5));
      assert.equal((await req(ticket)).status, 410);
      assert.equal((await authorize(id)).status, 409);
      assert.equal(wallet.snapshot('employee').entries.filter((e) => e.delta === -downloadPriceRaw).length, 1);
      assert.equal((await authorize(secondRequest)).status, 409);
      assert.equal(wallet.snapshot('employee').heldRaw, 0);
      const next = (await (await authorize(randomUUID())).json()).downloadPath;
      now += 31 * 60000;
      billing.expire();
      assert.equal((await req(next)).status, 410);
      assert.equal(wallet.snapshot('employee').heldRaw, 0);
      const again = (await (await authorize(randomUUID())).json()).downloadPath;
      assert.deepEqual(Buffer.from(await (await req(again)).arrayBuffer()), bytes);
      assert.equal(wallet.balance('employee'), 0);
      assert.equal(wallet.snapshot('employee').entries.filter((e) => e.delta === -downloadPriceRaw).length, 2);
      await unlink(file);
      assert.equal((await authorize(randomUUID())).status, 404);
    } finally {
      server.close();
      server.closeAllConnections();
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

test('long-running streams remain a single receipt until the download ends and retries reference it after restart', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const wallet = createWallet(db);
    let clock = Date.now();
    const item = { id: 'document', sha256: 'fixture-sha', bytes: 10 };
    const config = { db, wallet, now: () => clock };
    const first = createArchiveDownloads(config);
    wallet.credit({ userId: 'worker', reference: 'seed', amountRaw: downloadPriceRaw * 2 });
    const receipt = first.authorize('worker', item, randomUUID());
    first.begin('worker', item, receipt, 0);
    clock += 31 * 60_000;
    const retryId = randomUUID();
    assert.equal(first.authorize('worker', item, retryId), receipt);
    assert.equal(wallet.snapshot('worker').heldRaw, 0);
    assert.throws(
      () => first.begin('worker', item, receipt, 0),
      (e) => e.status === 409,
    );
    first.end(receipt, item.bytes);
    const restarted = createArchiveDownloads(config);
    assert.throws(
      () => restarted.authorize('worker', item, retryId),
      (e) => e.status === 409,
    );
    assert.equal(wallet.balance('worker'), downloadPriceRaw);
  } finally {
    db.close();
  }
});
