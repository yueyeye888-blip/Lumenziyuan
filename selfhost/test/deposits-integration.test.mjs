import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createDeposits } from '../commerce/deposits.mjs';
import { chains, receivingAddress } from '../commerce/usdt-chain.mjs';
import { createWallet } from '../commerce/wallet.mjs';
import { createCommerce } from '../commerce/commerce.mjs';
import { randomUUID } from 'node:crypto';

const address = (n) => '0x' + n.toString(16).padStart(40, '0');
const hash = (n) => '0x' + BigInt(n).toString(16).padStart(64, '0');
const topic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const tronAddress = 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8';
function fixture(id = 'ETH', overrides = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE credits(user TEXT, amount INTEGER, ref TEXT UNIQUE)');
  const clock = { now: 1730000000000 },
    rpc = { final: 100, tip: 100, times: new Map(), events: [], badReceipt: false, failLogs: false, chain: id };
  const options = {
    addresses: id === 'TRON' ? [tronAddress] : [address(11), address(12), address(13)],
    rpcUrl: 'https://example.test',
  };
  const hex = (n) => '0x' + n.toString(16);
  const block = (n) => ({
    number: hex(n),
    hash: hash(n),
    timestamp: hex(rpc.times.get(n) ?? Math.floor(clock.now / 1000)),
  });
  async function fetchImpl(url, init) {
    const { method, params } = JSON.parse(init.body);
    let result;
    if (method === 'eth_chainId') result = hex(chains[rpc.chain].chainId);
    if (method === 'eth_getBlockByNumber')
      result = block(params[0] === 'latest' ? rpc.tip : params[0] === 'finalized' ? rpc.final : Number(params[0]));
    if (method === 'eth_getLogs') {
      if (rpc.failLogs) throw new Error('mock outage');
      const query = params[0];
      assert.equal(query.address, chains[id].contract);
      result = rpc.events.filter(
        (log) => Number(log.blockNumber) >= Number(query.fromBlock) && Number(log.blockNumber) <= Number(query.toBlock)
      );
    }
    if (method === 'eth_getTransactionReceipt') {
      const logs = rpc.events.filter((log) => log.transactionHash === params[0]);
      result = {
        transactionHash: params[0],
        blockHash: logs[0].blockHash,
        blockNumber: logs[0].blockNumber,
        status: rpc.badReceipt ? '0x0' : '0x1',
        logs,
      };
    }
    return Response.json({ id: 1, jsonrpc: '2.0', result });
  }
  const args = {
    db,
    config: { networks: { [id]: options } },
    fetchImpl,
    now: () => clock.now,
    credit: (item) => db.prepare('INSERT INTO credits VALUES (?,?,?)').run(item.userId, item.amountRaw, item.reference),
    ...overrides,
  };
  const deposits = createDeposits(args);
  async function order(userId = 'buyer', requestId = 'test-123456', amount = 50) {
    return deposits.create({ userId, network: id, requestId, amount });
  }
  function transfer(
    order,
    n,
    {
      amount = order.expectedAmount,
      index = 0,
      tx = n + 5000,
      contract = chains[id].contract,
      recipient = order.address,
    } = {}
  ) {
    const [whole, fraction = ''] = amount.split('.');
    const units = BigInt(whole + fraction.padEnd(chains[id].decimals, '0'));
    rpc.events.push({
      address: contract,
      topics: [topic, hash(123), '0x' + receivingAddress(id, recipient).slice(2).padStart(64, '0')],
      data: hash(units),
      blockNumber: hex(n),
      blockHash: hash(n),
      transactionHash: hash(tx),
      logIndex: hex(index),
    });
    rpc.times.set(n, Math.floor(clock.now / 1000));
    rpc.tip = Math.max(rpc.tip, n);
  }
  return { args, db, clock, rpc, deposits, order, transfer };
}

for (const id of Object.keys(chains))
  test(id + ' credits principal once after finality; suffix never becomes balance', async () => {
    const { db, clock, rpc, deposits, order, transfer, args } = fixture(id);
    const a = await order();
    assert.match(a.expectedAmount, /^50\.(?!00)\d{2}$/);
    assert.equal(new Date(a.expiresAt) - new Date(a.createdAt), 30 * 60000);
    assert.equal((await order()).id, a.id);
    assert.equal(deposits.get('another', a.id), null);
    clock.now += 29 * 60000;
    transfer(a, 101);
    await deposits.poll();
    assert.equal(deposits.get('buyer', a.id).status, 'confirming');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM credits').get().n, 0);
    // Finalization is later than the deadline; original block time still qualifies.
    clock.now += 8 * 60000;
    rpc.final = 101;
    const restarted = createDeposits(args);
    await restarted.poll();
    assert.equal(restarted.get('buyer', a.id).status, 'credited');
    assert.equal(restarted.get('buyer', a.id).paidAmount, a.expectedAmount.replace(/0$/, '').replace(/\.$/, ''));
    assert.equal(db.prepare('SELECT amount FROM credits').get().amount, 500000);
    assert.equal(restarted.list('buyer')[0].txHash, hash(5101));
    // Simulate same transfer returned again after a checkpoint replay.
    db.prepare('UPDATE deposit_cursors SET height=100 WHERE network=?').run(id);
    await restarted.poll();
    assert.equal(db.prepare('SELECT count(*) n FROM credits').get().n, 1);
  });

test('order allocation, mismatch and late-payment review', async () => {
  const { db, clock, rpc, deposits, order, transfer } = fixture();
  await assert.rejects(order('buyer', 'small-12345', 4), { status: 400 });
  const [first, other] = await Promise.all([order(), order('another')]);
  assert.notEqual(first.address, other.address);
  const third = await order('buyer', 'third-12345', 10);
  assert.notEqual(third.address, first.address);
  transfer(first, 101, { amount: '49.90' });
  clock.now += 31 * 60000;
  transfer(other, 102);
  assert.equal((await order('buyer', 'third-12345', 10)).id, third.id);
  assert.equal(deposits.networks().find((n) => n.id === 'ETH').enabled, false);
  rpc.final = 102;
  await deposits.poll();
  assert.equal(deposits.get('buyer', first.id).status, 'review');
  assert.equal(deposits.get('another', other.id).status, 'review');
  assert.deepEqual(
    deposits.reviews().map((o) => o.reason),
    ['outside_window', 'amount_mismatch']
  );
  assert.equal(db.prepare('SELECT COUNT(*) n FROM credits').get().n, 0);
});

test('wrong token, wrong recipient, failed receipt, reorg, stopped monitor and durable retries', async () => {
  const { db, rpc, deposits, order, transfer, args } = fixture();
  const a = await order();
  transfer(a, 101, { contract: address(789), index: 1 });
  transfer(a, 101, { recipient: address(799), index: 2 });
  transfer(a, 101);
  rpc.badReceipt = true;
  await deposits.poll();
  assert.equal(deposits.get('buyer', a.id).status, 'pending');
  rpc.badReceipt = false;
  await deposits.poll();
  assert.equal(deposits.get('buyer', a.id).status, 'confirming');
  rpc.events.pop();
  await deposits.poll();
  assert.equal(deposits.get('buyer', a.id).status, 'pending');
  transfer(a, 102);
  rpc.final = 102;
  rpc.failLogs = true;
  await deposits.poll();
  assert.equal(deposits.health().find((n) => n.id === 'ETH').lastFinalizedBlock, 100);
  rpc.failLogs = false;
  let broken = true;
  const service = createDeposits({
    ...args,
    credit: (e) => {
      if (broken) throw new Error('ledger unavailable');
      return args.credit(e);
    },
  });
  await service.poll();
  assert.equal(service.get('buyer', a.id).status, 'pending');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM deposit_events').get().n, 0);
  broken = false;
  await service.poll();
  assert.equal(service.get('buyer', a.id).status, 'credited');
});

test('validates network, live RPC, address checksum and NULL configuration', async () => {
  const { rpc, order, db, deposits } = fixture();
  rpc.chain = 'BSC';
  await assert.rejects(order(), { status: 503 });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM deposit_orders').get().n, 0);
  assert.equal(
    deposits.networks().every((n) => !n.enabled),
    true
  );
  rpc.chain = 'ETH';
  await deposits.poll();
  assert.equal(deposits.networks().find((n) => n.id === 'ETH').enabled, true);
  assert.throws(() => receivingAddress('TRON', 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv9'), /校验失败/);
  assert.throws(() => receivingAddress('TRON', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'), /合约地址/);
  assert.throws(() => receivingAddress('ETH', address(0)), /零地址/);
  assert.equal(
    createDeposits({ db, credit: () => {} })
      .networks()
      .some((n) => n.enabled),
    false
  );
});

test('one shared address serves concurrent users, never reassigns a retired quote, and separates unassigned transfers', async () => {
  const { args, rpc, db, transfer, clock } = fixture();
  const network = 'ETH',
    shared = createDeposits({
      ...args,
      config: { networks: { ETH: { mode: 'shared', rpcUrl: 'https://example.test', addresses: [address(11)] } } },
    });
  await shared.poll();
  const quotes = await Promise.all(
    Array.from({ length: 101 }, (_, i) =>
      shared.create({ userId: 'u' + i, requestId: 'req-order' + i, network, amount: 50 })
    )
  );
  assert.equal(new Set(quotes.map((q) => q.expectedAmount)).size, 101);
  assert.equal(new Set(quotes.map((q) => q.address)).size, 1);
  assert.ok(quotes.slice(0, 9).every((q) => /^50\.\d{2}$/.test(q.expectedAmount)));
  assert.ok(quotes.slice(9,90).every((q) => /^50\.\d{3}$/.test(q.expectedAmount)));
  assert.ok(quotes.slice(90).every(q=>/^50\.\d{4}$/.test(q.expectedAmount)));
  assert.ok(quotes.every(q => Number(q.expectedAmount) <= 50.09));
  const followup = await shared.create({ userId: 'u0', requestId: 'same-owner-new-request', network, amount: 50 });
  assert.notEqual(followup.id, quotes[0].id);
  assert.notEqual(followup.expectedAmount, quotes[0].expectedAmount);
  db.prepare('INSERT INTO deposit_request_aliases VALUES(?,?,?)').run('u0', 'another-id', quotes[0].id);
  const alias = await shared.create({ userId: 'u0', requestId: 'another-id', network, amount: 50 });
  assert.equal(alias.id, quotes[0].id);
  transfer(quotes[0], 101);
  transfer(quotes[4], 101, { index: 2 });
  transfer(quotes[4], 101, { index: 3, amount: '37.08' });
  rpc.final = 101;
  await shared.poll();
  assert.equal(shared.get('u0', quotes[0].id).status, 'credited');
  assert.equal(shared.get('u4', quotes[4].id).status, 'credited');
  assert.equal(shared.get('u1', quotes[1].id).status, 'pending');
  assert.equal((await shared.create({ userId: 'u0', requestId: 'another-id', network, amount: 50 })).id, quotes[0].id);
  assert.equal(shared.reviews()[0].orderId, null);
  assert.equal(shared.reviews()[0].reason, 'unmatched');
  assert.equal(shared.reviews()[0].paidAmount, '37.08');
  clock.now += 31 * 60000;
  rpc.tip = 102;
  const after = await shared.create({ userId: 'u1', requestId: 'after-late-1', network, amount: 50 });
  assert.notEqual(after.expectedAmount, quotes[1].expectedAmount);
  transfer(quotes[1], 103);
  rpc.final = 103;
  await shared.poll();
  assert.equal(shared.get('u1', after.id).status, 'pending');
  assert.equal(shared.get('u1', quotes[1].id).status, 'review');
  assert.equal(db.prepare('select count(*) n from credits').get().n, 2);
});

test('same-account concurrent quotes for integer and custom amounts settle separately with exact cents', async () => {
  const { args, db, rpc, transfer } = fixture();
  const deposits = createDeposits({
    ...args,
    config: { networks: { ETH: { mode: 'shared', rpcUrl: 'https://example.test', addresses: [address(11)] } } },
  });
  function create(amount, requestId = 'order-custom-1') {
    return deposits.create({ userId: 'buyer', network: 'ETH', requestId, amount });
  }
  for (const invalid of ['4.99', '5.001', '5e1', '900719925475.01']) {
    await assert.rejects(create(invalid), { status: 400 });
  }
  const [first, duplicate, second, third, crossing] = await Promise.all([
    create('50.03'), create(50.03), create(50, 'order-preset-1'),
    create('50.05', 'order-custom-2'), create('50.99', 'order-custom-3'),
  ]);
  const orders = [first, second, third, crossing];
  assert.equal(first.id, duplicate.id);
  assert.equal(new Set(orders.map((o) => o.expectedAmount)).size, orders.length);
  assert.ok(orders.every((o) => o.status === 'pending'));
  assert.ok(orders.every((o) => Number(o.expectedAmount) > o.amount && Number(o.expectedAmount) <= o.amount + 0.09));
  assert.ok(orders.every((o) => !Number.isInteger(Number(o.expectedAmount))));
  await assert.rejects(create('50.04'), { status: 409 });
  for (const [i, order] of orders.entries()) transfer(order, 101, { index: i });
  rpc.final = 101;
  const restarted = createDeposits({
    ...args,
    config: { networks: { ETH: { mode: 'shared', rpcUrl: 'https://example.test', addresses: [address(11)] } } },
  });
  await restarted.poll();
  assert.ok(restarted.list('buyer').every((o) => o.creditedAmount === o.amount));
  assert.deepEqual(db.prepare('SELECT amount FROM credits ORDER BY amount').all().map(({ amount }) => amount), [
    500000, 500300, 500500, 509900,
  ]);
});

test('manual review ties confirmed event to the same target and records one atomic ledger movement', async () => {
  const { db, rpc, order, transfer, deposits } = fixture();
  const a = await order();
  transfer(a, 101, { amount: '43.88' });
  rpc.final = 101;
  await deposits.poll();
  const event = deposits.reviews()[0],
    cmd = { ...event, action: 'credit', userId: 'buyer', principal: '43.08', actor: 'admin', note: '已核对来款人' };
  assert.throws(() => deposits.resolve({ ...cmd, principal: 44 }), { status: 400 });
  assert.throws(() => deposits.resolve({ ...cmd, userId: 'another' }), { status: 409 });
  assert.equal(deposits.resolve(cmd).alreadyResolved, false);
  assert.equal(deposits.resolve(cmd).alreadyResolved, true);
  assert.throws(() => deposits.resolve({ ...cmd, principal: 42 }), { status: 409 });
  assert.equal(deposits.get('buyer', a.id).status, 'credited');
  assert.equal(deposits.get('buyer', a.id).paidAmount, '43.88');
  assert.equal(db.prepare('SELECT amount FROM credits').get().amount, 430800);
  assert.equal(deposits.reviews().length, 0);
  assert.equal(deposits.reviews(true)[0].actor, 'admin');
  transfer(a, 102);
  rpc.final = 102;
  await deposits.poll();
  const duplicate = deposits.reviews()[0];
  assert.throws(() => deposits.resolve({ ...cmd, txHash: duplicate.txHash, principal: 50 }), { status: 409 });
  deposits.resolve({ ...duplicate, action: 'acknowledge', actor: 'admin', note: '已线下处理' });
  assert.equal(deposits.reviews().length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM credits').get().n, 1);
});


test('exchange withdrawal mismatches are safely matched to eligible orders and credited only after admin review', async (t) => {
  // Use the real BSC precision and wallet ledger, with deterministic synthetic
  // amounts and mocked finalized Transfer events. Never call a live chain.
  const { db, args, rpc, clock, transfer } = fixture('BSC');
  t.after(() => db.close());
  const wallet = createWallet(db);
  const deposits = createDeposits({
    ...args,
    credit: wallet.credit,
    config: { networks: { BSC: { mode: 'shared', rpcUrl: 'https://example.test', addresses: [address(11)] } } },
  });
  await deposits.poll();
  async function quoted(userId, requestId, expected) {
    const order = await deposits.create({ userId, requestId, amount: 20, network: 'BSC' });
    // Quote allocation is random in production; freeze the test scenario only.
    const fractional = expected.split('.')[1];
    db.prepare('UPDATE deposit_orders SET units=?,fraction=? WHERE id=?')
      .run(BigInt('20' + fractional.padEnd(18, '0')).toString(), fractional, order.id);
    return deposits.get(userId, order.id);
  }
  function cloneOrder(source, overrides) {
    const row = { ...db.prepare('SELECT * FROM deposit_orders WHERE id=?').get(source.id),
      id: randomUUID(), request_id: randomUUID(), ...overrides };
    const columns = Object.keys(row);
    db.prepare('INSERT INTO deposit_orders(' + columns.join(',') + ') VALUES(' + columns.map(() => '?').join(',') + ')')
      .run(...columns.map(key => row[key]));
    return row.id;
  }
  const first = await quoted('buyer', 'exchange-case-first', '20.09');
  const wrongNetwork = cloneOrder(first, { network: 'ETH' });
  const wrongRecipient = cloneOrder(first, { address: address(12), recipient: address(12) });
  const firstTx = hash((0xaan << 248n) + 1n);
  const secondTx = hash((0xbbn << 248n) + 2n);
  const duplicateTx = hash((0xccn << 248n) + 3n);
  clock.now += 61000;
  transfer(first, 101, { amount: '20.08', tx: BigInt(firstTx), index: 78 });
  clock.now += 11 * 60000;
  rpc.tip = 102;
  const second = await quoted('buyer', 'exchange-case-second', '20.07');
  clock.now += 28000;
  transfer(second, 103, { amount: '19.99', tx: BigInt(secondTx), index: 66 });
  rpc.final = 103;
  // Expiry is not evidence that the money was lost. Confirmed transfers
  // with mismatched amounts enter review and do not alter the ledger.
  clock.now += 32 * 60000;
  await deposits.poll();
  rpc.tip = 104;
  const future = await quoted('another', 'future-after-transfers', '20.03');
  assert.equal(deposits.get('buyer', first.id).status, 'expired');
  assert.equal(deposits.get('buyer', second.id).status, 'expired');
  assert.equal(wallet.balance('buyer'), 0);
  const reviews = deposits.reviews();
  assert.equal(reviews.length, 2);
  const firstEvent = reviews.find(item => item.txHash === firstTx);
  const secondEvent = reviews.find(item => item.txHash === secondTx);
  assert.deepEqual([firstEvent.paidAmount, secondEvent.paidAmount], ['20.08', '19.99']);
  assert.ok(reviews.every(item => item.reason === 'unmatched' && item.orderId === null));
  const a = deposits.candidates(firstEvent);
  const b = deposits.candidates(secondEvent);
  assert.deepEqual(a.map(item => item.id), [first.id]);
  assert.equal(a[0].expectedAmount, '20.09');
  assert.equal(a[0].withinWindow, true);
  assert.equal(a[0].status, 'expired');
  assert.equal(Number(a[0].recommendedCredit), 20);
  assert.equal(b[0].id, second.id);
  assert.equal(b.find(item => item.id === second.id)?.expectedAmount, '20.07');
  assert.equal(Number(b.find(item => item.id === second.id)?.recommendedCredit), 19.99);
  for (const orderId of [wrongNetwork, wrongRecipient, future.id]) {
    assert.ok(!a.some(item => item.id === orderId));
    assert.ok(!b.some(item => item.id === orderId));
  }
  assert.deepEqual(deposits.reviews(false, firstTx.toUpperCase()).map(item => item.txHash), [firstTx]);
  assert.deepEqual(deposits.reviews(false, 'bb').map(item => item.txHash), [secondTx]);
  assert.deepEqual(deposits.reviews(false, hash(77)), []);
  assert.throws(() => deposits.reviews(false, 'x%'), { status: 400 });
  assert.deepEqual(deposits.candidates(secondEvent, first.id).map(item => item.id), [first.id]);
  assert.deepEqual(deposits.candidates(secondEvent, wrongNetwork), []);
  assert.deepEqual(deposits.candidates(firstEvent, second.id), []);
  // Two distinct users can have contemporaneous quotes on a shared address.
  // Similar amounts are only suggestions; no ownership is inferred.
  const partner = cloneOrder(first, {
    user_id: 'another', units: BigInt('20' + '04'.padEnd(18, '0')).toString(), fraction: '04'
  });
  assert.ok(deposits.candidates(firstEvent).some(item => item.id === partner));
  const owner = { id: 'admin', role: 'employee', email: 'admin@example.invalid' };
  const operator = { id: 'operator', role: 'employee', email: 'operator@example.invalid' };
  const buyer = { id: 'buyer', role: 'customer', email: 'buyer@example.invalid' };
  const another = { id: 'another', role: 'employee', email: 'another@example.invalid' };
  const accounts = [owner, operator, buyer, another];
  const config = { origin: 'https://example.test', bindings: { RESOURCE_ADMIN_EMAILS: owner.email + ',' + operator.email } };
  const commerce = createCommerce({ db, config, wallet, deposits, mf: {}, purchases: {},
    identities: {
      list: () => accounts,
      byEmail: email => accounts.find(account => account.email === email),
    },
    readBody: async req => Buffer.from(JSON.stringify(req.fields)),
  });
  async function call(path, user = owner, fields) {
    let status, body;
    const req = { method: fields ? 'POST' : 'GET', fields,
      headers: { origin: config.origin, 'content-type': 'application/json' } };
    const res = { writeHead(n) { status = n; }, end(value) { body = JSON.parse(value); } };
    assert.equal(await commerce.route(req, res, new URL(path, config.origin), user), true);
    return { status, body };
  }
  async function submit(event, orderId, principal, fields = {}, user = owner) {
    return call('/api/commerce/admin/review', user, {
      network: event.network, txHash: event.txHash, logIndex: event.logIndex,
      action: 'credit', email: buyer.email, orderId, principal,
      note: 'Exchange payout verified in test', ...fields,
    });
  }
  const publicDenied = await call('/api/commerce/admin/deposits', buyer);
  assert.equal(publicDenied.status, 403);
  assert.equal((await submit(firstEvent, first.id, '20', {}, buyer)).status, 403);
  assert.equal((await submit(firstEvent, first.id, '20', { orderId: undefined })).status, 400);
  const overview = await call('/api/commerce/admin/deposits?txHash=aa');
  assert.equal(overview.status, 200);
  assert.equal(overview.body.history.length, 0);
  assert.equal(overview.body.reviews.length, 1);
  assert.equal(overview.body.reviews[0].txHash, firstTx);
  assert.equal(overview.body.reviews[0].candidates[0].email, buyer.email);
  assert.equal(overview.body.reviews[0].candidates[0].canCredit, true);
  assert.equal((await call('/api/commerce/admin/deposits?orderId=invalid')).status, 400);
  assert.equal((await call('/api/commerce/admin/deposits?txHash=z')).status, 400);
  const exactQuery = '/api/commerce/admin/deposits?txHash=aa&orderId=' + partner;
  assert.equal((await call(exactQuery)).body.reviews[0].candidates[0].canCredit, true);
  const restrictedCandidate = (await call(exactQuery, operator)).body.reviews[0].candidates[0];
  assert.equal(restrictedCandidate.email, another.email);
  assert.equal(restrictedCandidate.canCredit, false);
  // Verified Transfer identity, candidate account/order and actual amount
  // are re-checked server-side rather than being trusted from the browser.
  assert.equal((await submit(firstEvent, first.id, '20.08')).status, 409);
  assert.equal((await submit(firstEvent, first.id, '20', { email: another.email })).status, 409);
  assert.equal((await submit(firstEvent, first.id, '20', { email: another.email }, operator)).status, 403);
  assert.equal((await submit(firstEvent, wrongNetwork, '20')).status, 409);
  assert.equal((await submit(firstEvent, wrongRecipient, '20')).status, 409);
  assert.equal((await submit(firstEvent, second.id, '20')).status, 409);
  assert.equal((await submit(secondEvent, second.id, '20')).status, 400);
  assert.equal((await submit(secondEvent, future.id, '19.99', { email: another.email })).status, 409);
  // If a separate matching transfer is still awaiting finality, block
  // manual credit until its outcome is known.
  db.prepare('INSERT INTO deposit_seen VALUES(?,?,?,?)')
    .run(second.id, hash(1234), '20070000000000000000', 106);
  assert.equal(deposits.candidates(secondEvent, second.id)[0].canCredit, false);
  assert.equal((await submit(secondEvent, second.id, '19.99')).status, 409);
  db.prepare('DELETE FROM deposit_seen WHERE order_id=?').run(second.id);
  // A failed wallet write rolls back both the order update and resolution.
  const brokenLedger = createDeposits({ ...args, credit: () => { throw Error('ledger unavailable'); } });
  assert.throws(() => brokenLedger.resolve({
    ...firstEvent, action: 'credit', orderId: first.id, principal: '20',
    userId: buyer.id, actor: owner.id, note: 'synthetic ledger failure'
  }), /ledger unavailable/);
  assert.equal(deposits.get('buyer', first.id).status, 'expired');
  assert.equal(deposits.reviews().length, 2);
  assert.equal(wallet.balance('buyer'), 0);
  const firstCredit = await submit(firstEvent, first.id, '20');
  assert.equal(firstCredit.status, 200);
  assert.equal(firstCredit.body.resolution.alreadyResolved, false);
  assert.equal((await submit(firstEvent, first.id, '20')).body.resolution.alreadyResolved, true);
  assert.equal((await submit(firstEvent, first.id, '19.99')).status, 409);
  assert.equal((await submit(secondEvent, first.id, '19.99')).status, 409);
  assert.ok(!deposits.candidates(secondEvent).some(item => item.id === first.id));
  const secondCredit = await submit(secondEvent, second.id, '19.99');
  assert.equal(secondCredit.status, 200);
  assert.equal(wallet.balance('buyer'), 399900);
  assert.equal(wallet.balance('another'), 0);
  assert.equal(deposits.get('buyer', first.id).creditedAmount, 20);
  assert.equal(deposits.get('buyer', first.id).paidAmount, '20.08');
  assert.equal(deposits.get('buyer', second.id).creditedAmount, 19.99);
  assert.equal(deposits.get('buyer', second.id).paidAmount, '19.99');
  assert.equal(deposits.reviews().length, 0);
  const history = deposits.history();
  assert.equal(history.length, 2);
  assert.ok(history.every(item => item.action === 'credit' && item.actor === 'admin'));
  assert.deepEqual(deposits.history('aa').map(item => item.txHash), [firstTx]);
  const historyResponse = await call('/api/commerce/admin/deposits?txHash=bb');
  assert.equal(historyResponse.status, 200);
  assert.equal(historyResponse.body.reviews.length, 0);
  assert.equal(historyResponse.body.history[0].creditedEmail, buyer.email);
  assert.equal(historyResponse.body.history[0].actorEmail, owner.email);
  // Repeat scans, including a new event paying an already credited quote,
  // must not add any extra balance or change the resolved history.
  db.prepare("UPDATE deposit_cursors SET height=100 WHERE network='BSC'").run();
  await deposits.poll();
  transfer(first, 105, { tx: BigInt(duplicateTx) });
  rpc.final = 105;
  await deposits.poll();
  const extra = deposits.reviews().find(item => item.txHash === duplicateTx);
  assert.equal(extra.reason, 'extra');
  assert.deepEqual(deposits.candidates(extra), []);
  assert.equal((await submit(extra, first.id, '20')).status, 409);
  const acknowledged = await submit(extra, first.id, null, { action: 'acknowledge', email: undefined });
  assert.equal(acknowledged.status, 200);
  assert.equal(deposits.history('cc')[0].action, 'acknowledge');
  assert.equal(wallet.balance('buyer'), 399900);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM wallet_entries').get().n, 2);
});
