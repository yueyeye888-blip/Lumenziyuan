import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createDeposits } from '../commerce/deposits.mjs';
import { chains, receivingAddress } from '../commerce/usdt-chain.mjs';

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
  await assert.rejects(order('buyer', 'other-12345', 10), { status: 409 });
  transfer(first, 101, { amount: '49.90' });
  clock.now += 31 * 60000;
  transfer(other, 102);
  const third = await order('buyer', 'third-12345');
  assert.notEqual(third.address, first.address);
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

test('manual review ties confirmed event to the same target and records one atomic ledger movement', async () => {
  const { db, rpc, order, transfer, deposits } = fixture();
  const a = await order();
  transfer(a, 101, { amount: '43.88' });
  rpc.final = 101;
  await deposits.poll();
  const event = deposits.reviews()[0],
    cmd = { ...event, action: 'credit', userId: 'buyer', principal: 43, actor: 'admin', note: '已核对来款人' };
  assert.throws(() => deposits.resolve({ ...cmd, principal: 44 }), { status: 400 });
  assert.throws(() => deposits.resolve({ ...cmd, userId: 'another' }), { status: 409 });
  assert.equal(deposits.resolve(cmd).alreadyResolved, false);
  assert.equal(deposits.resolve(cmd).alreadyResolved, true);
  assert.throws(() => deposits.resolve({ ...cmd, principal: 42 }), { status: 409 });
  assert.equal(deposits.get('buyer', a.id).status, 'credited');
  assert.equal(deposits.get('buyer', a.id).paidAmount, '43.88');
  assert.equal(db.prepare('SELECT amount FROM credits').get().amount, 430000);
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
