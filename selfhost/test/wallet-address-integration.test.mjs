import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, symlink, rename, mkdir, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createWallet } from '../commerce/wallet.mjs';
import { createAddressBilling, addressPriceRaw } from '../commerce/address-billing.mjs';
import { worker } from '../runtime.mjs';
import { trustedHeaders } from '../auth.mjs';

const source = fileURLToPath(new URL('..', import.meta.url));
const user = { id: 'customer-one', email: 'placeholder@example.invalid', name: 'Fixture Customer' };
const profile = {
  fullName: 'Test Customer',
  addressLines: ['Fixture street', '', ''],
  recipientEmail: 'fixture@example.invalid',
};
test('wallet atomically limits combined pending purchases and works on Node without isTransaction', () => {
  const raw = new DatabaseSync(':memory:');
  const db = { exec: raw.exec.bind(raw), prepare: raw.prepare.bind(raw) };
  const wallet = createWallet(db),
    id = user.id;
  raw.exec('BEGIN IMMEDIATE');
  wallet.credit({ userId: id, amountRaw: 150000, reference: 'deposit:test' });
  raw.exec('ROLLBACK');
  assert.equal(wallet.balance(id), 0);
  wallet.credit({ userId: id, amountRaw: 150000, reference: 'admin:one', actor: 'admin' });
  assert.equal(wallet.credit({ userId: id, amountRaw: 150000, reference: 'admin:one', actor: 'admin' }), false);
  assert.throws(() => wallet.credit({ userId: id, amountRaw: 150001, reference: 'admin:one', actor: 'admin' }), {
    status: 409,
  });
  wallet.reserve(id, 'purchase:one', 100000);
  assert.throws(() => wallet.reserve(id, 'purchase:two', 100000), { status: 402 });
  assert.equal(wallet.balance(id), 50000);
  wallet.capture(id, 'purchase:one');
  wallet.capture(id, 'purchase:one');
  assert.equal(wallet.snapshot(id).heldRaw, 0);
  assert.equal(wallet.balance(id), 50000);
  raw.close();
});

test('packaged Worker validates the billed order reference; a failed prepaid order requires owner review', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'lumen-billing-'));
  await symlink(path.join(source, 'dist'), path.join(root, 'dist'), 'dir');
  await mkdir(path.join(root, 'data'));
  const config = {
    origin: 'https://billing.invalid',
    bindings: { ADDRESS_ORDER_CALLBACK_TOKEN: 'fixture-token', RESOURCE_ADMIN_EMAILS:'boss@example.invalid' },
    siteOrderQueueDirectory: path.join(root, 'queue'),
  };
  const mf = worker(root, config);
  const db = new DatabaseSync(':memory:'),
    wallet = createWallet(db);
  try {
    await mf.ready;
    const d1 = await mf.getD1Database('DB');
    for (const file of (await readdir(path.join(source, 'drizzle'))).filter((f) => f.endsWith('.sql')).sort()) {
      const sql = await readFile(path.join(source, 'drizzle', file), 'utf8');
      await d1.batch(
        sql
          .split('--> statement-breakpoint')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => d1.prepare(s))
      );
    }
    const headers = trustedHeaders({}, user);
    const templates = await mf.dispatchFetch(config.origin + '/api/supplier-templates', { headers });
    assert.equal(templates.status, 200);
    const { id, name } = (await templates.json()).items[0];
    const payload = Buffer.from(JSON.stringify({ template: { id, name }, profile }));
    const owner={id:'boss',email:'boss@example.invalid',role:'employee'};
    const bill = createAddressBilling({ db, mf, wallet, config });
    await assert.rejects(bill.submit(user, randomUUID(), payload), { status: 402 });
    const unsigned = await mf.dispatchFetch(config.origin + '/api/personal-details/submit', {
      method: 'POST',
      headers,
      body: payload,
    });
    assert.equal(unsigned.status, 402);
    wallet.credit({ userId: user.id, amountRaw: 100000, reference: 'admin:test' });
    const key = randomUUID();
    const result = await bill.submit(user, key, payload);
    assert.equal(result.status, 202);
    assert.equal(
      (await d1.prepare('SELECT status FROM address_orders WHERE request_no=?').bind(result.data.requestNo).first())
        .status,
      'failed'
    );
    assert.equal(wallet.balance(user.id), 0);
    await bill.decideRefund(owner,'address:'+key,'approved','确认异常');
    assert.equal(wallet.balance(user.id),100000);
    assert.equal(wallet.snapshot(user.id).heldRaw, 0);
    assert.equal(result.data.paymentStatus,'review');
    assert.equal(wallet.snapshot(user.id).entries.filter(e=>e.reference.startsWith('refund:')).length,1);
    assert.equal((await bill.submit(user, key, payload)).data.requestNo, result.data.requestNo);
    assert.equal((await d1.prepare('SELECT COUNT(*) n FROM address_orders').first()).n, 1);
    assert.equal(existsSync(path.join(config.siteOrderQueueDirectory, result.data.requestNo, 'pending.json')), false);
    assert.equal(
      existsSync(path.join(config.siteOrderQueueDirectory, result.data.requestNo, 'billing-staged.json')),
      false
    );
    const callback = (requestNo, status) =>
      mf.dispatchFetch(config.origin + '/api/address-orders/callback', {
        method: 'POST',
        headers: { authorization: 'Bearer fixture-token', 'content-type': 'application/json' },
        body: JSON.stringify({ requestNo, status }),
      });
    assert.equal((await callback(result.data.requestNo, 'failed')).status, 200);
    const conflict = await callback(result.data.requestNo, 'delivered');
    assert.equal(conflict.status, 409, await conflict.text());
    // Old unpaid orders keep their original callback behavior.
    const legacy = 'ADDR-20200101-00000000';
    await d1
      .prepare(
        `INSERT INTO address_orders (id,request_no,user_id,user_email,user_name,template_id,template_name,subject_name,recipient_email,status) SELECT ?,?,user_id,user_email,user_name,template_id,template_name,subject_name,recipient_email,status FROM address_orders WHERE request_no=?`
      )
      .bind('legacy', legacy, result.data.requestNo)
      .run();
    assert.equal((await callback(legacy, 'delivered')).status, 200);
    const invalidKey = randomUUID();
    const invalid = await bill.submit(
      user,
      invalidKey,
      Buffer.from(JSON.stringify({ template: { id: 999999, name: 'unknown' }, profile }))
    );
    assert.equal(invalid.status, 400);
    await bill.decideRefund(owner,'address:'+invalidKey,'approved','确认入账');
    assert.equal(wallet.balance(user.id), 100000);
    const agent = {...user, discountBps:8000};
    await assert.rejects(bill.submit(agent,randomUUID(),payload,100000),{status:409});
    const agentKey = randomUUID();
    const discounted = await bill.submit(agent,agentKey,payload,80000);
    assert.equal(discounted.data.paidAmountRaw,80000);
    assert.equal(discounted.data.paymentStatus,'review');
    await bill.decideRefund(owner,'address:'+agentKey,'approved','确认异常');
    assert.equal(wallet.balance(user.id),100000);
    assert.equal(wallet.snapshot(user.id).entries.find(e=>e.reference==='refund:address:'+agentKey).delta,80000);
    assert.equal((await bill.submit({...agent,discountBps:7500},agentKey,payload,75000)).data.paidAmountRaw,80000);
  } finally {
    await mf.dispose();
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('restart recovers one acknowledged queue file, charges once before generation and does not resend an ambiguous order', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'lumen-staging-'));
  const db = new DatabaseSync(':memory:'),
    wallet = createWallet(db),
    orders = new Map();
  let now = Date.now(),
    dispatches = 0,
    throwAfterDispatch = false;
  const d1 = {
    batch: async () => [],
    prepare(sql) {
      return {
        bind(...args) {
          return {
            first: async () => {
              const n = orders.get(args[0]);
              return n?.user === args[1] ? { status: n.status } : null;
            },
            run: async () => {
              assert.ok(sql.includes('status_message'));
              orders.get(args[2]).message = args[0];
              if (sql.includes("SET status='failed'")) orders.get(args[2]).status='failed';
            },
          };
        },
      };
    },
  };
  const mf = {
    getD1Database: async () => d1,
    dispatchFetch: async (_url, init) => {
      dispatches++;
      assert.equal(wallet.snapshot(user.id).heldRaw,0);
      assert.equal(wallet.snapshot(user.id).entries.filter(entry=>entry.delta===-addressPriceRaw).length,dispatches);
      const requestNo = init.headers.get('x-lumen-billed-address-order');
      orders.set(requestNo, { status: 'queued', user: user.id });
      if (throwAfterDispatch) throw Error('response lost');
      return Response.json({ ok: true, requestNo }, { status: 202 });
    },
  };
  const config = { origin: 'https://billing.invalid', siteOrderQueueDirectory: root };
  const make = () => createAddressBilling({ db, mf, wallet, config, now: () => now });
  const a = make(),
    payload = Buffer.from(JSON.stringify({ template: { id: 12, name: 'Fixture' }, profile }));
  try {
    wallet.credit({ userId: user.id, amountRaw: addressPriceRaw * 2, reference: 'admin:test' });
    const firstKey = randomUUID(),
      result = await a.submit(user, firstKey, payload);
    assert.equal(wallet.snapshot(user.id).heldRaw, 0);
    assert.equal(result.data.paymentStatus,'paid');
    assert.equal(wallet.snapshot(user.id).entries.filter(e=>e.delta<0).length,1);
    const job = path.join(root, result.data.requestNo);
    await access(path.join(job, 'pending.json'));
    // Simulate crashing after receipt persistence and before the first publication.
    await rename(path.join(job, 'pending.json'), path.join(job, 'billing-staged.json'));
    db.prepare("UPDATE address_queue_intents SET state='ready' WHERE bill_id=?").run('address:' + firstKey);
    const restarted = make();
    await restarted.sync();
    await access(path.join(job, 'pending.json'));
    // Simulate the consumer taking the job before publication status is committed.
    await rename(path.join(job, 'pending.json'), path.join(job, 'processing.json'));
    db.prepare("UPDATE address_queue_intents SET state='ready' WHERE bill_id=?").run('address:' + firstKey);
    await restarted.sync();
    assert.equal(existsSync(path.join(job, 'pending.json')), false);
    assert.equal((await restarted.submit(user, firstKey, payload)).data.requestNo, result.data.requestNo);
    assert.equal(dispatches, 1);
    orders.get(result.data.requestNo).status = 'delivered';
    await restarted.sync();
    await restarted.sync();
    assert.equal(wallet.balance(user.id), addressPriceRaw);
    assert.equal(wallet.snapshot(user.id).entries.filter((e) => e.delta < 0).length, 1);
    const key = randomUUID();
    throwAfterDispatch = true;
    await assert.rejects(restarted.submit(user, key, payload), /response lost/);
    now += 11 * 60_000;
    await make().sync();
    const ref = db.prepare('SELECT request_no FROM address_bills WHERE id=?').get('address:' + key).request_no;
    assert.match(orders.get(ref).message, /人工复核/);
    assert.equal(existsSync(path.join(root, ref, 'pending.json')), false);
    assert.equal((await restarted.submit(user, key, payload)).data.requestNo, ref);
    assert.equal(dispatches, 2);
    assert.equal(wallet.snapshot(user.id).heldRaw, 0);
    // A previously submitted order still uses the settlement terms in effect when it was paid for.
    for (const status of ['failed','delivered']) {
      const owner='legacy-'+status, id='address:'+randomUUID(), reference='old-'+randomUUID();
      wallet.credit({userId:owner,reference:'seed:'+owner,amountRaw:addressPriceRaw});
      wallet.reserve(owner,id,addressPriceRaw);
      db.prepare("INSERT INTO address_bills VALUES(?,?,?,?,?,'held')").run(id,reference,owner,'old-hash',now);
      orders.set(reference,{status,user:owner});
      await make().sync();
      assert.equal(wallet.snapshot(owner).heldRaw,status==='failed'?addressPriceRaw:0);
      assert.equal(wallet.balance(owner),0);
      assert.equal(wallet.snapshot(owner).entries.length,status==='failed'?1:2);
    }
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});
