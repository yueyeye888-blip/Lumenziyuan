import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createWallet } from '../commerce/wallet.mjs';
import { createAddressBilling } from '../commerce/address-billing.mjs';
import { processSiteQueue } from '../site-order-queue.mjs';

test('healthy queues wait and only the owner can settle an unavailable consumer refund once', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'billing-timeout-'));
  const directory = path.join(root,'queue');
  await mkdir(directory);
  const db = new DatabaseSync(':memory:');
  t.after(async () => { db.close(); await rm(root, {recursive:true, force:true}); });
  db.exec('CREATE TABLE address_orders(request_no TEXT PRIMARY KEY,user_id TEXT,status TEXT,status_message TEXT,error TEXT,updated_at TEXT,external_order_no TEXT,payment_amount TEXT)');
  const d1 = {
    prepare(sql) {
      return {bind(...args) { return {
        first: async () => db.prepare(sql).get(...args),
        run: async () => ({meta:db.prepare(sql).run(...args)}),
      }; }};
    },
    batch: async () => {},
  };
  const user = {id:'owner',email:'owner@example.invalid',discountBps:8000};
  const mf = {getD1Database:async()=>d1, dispatchFetch:async (_url, init) => {
    const requestNo = init.headers.get('x-lumen-billed-address-order');
    db.prepare("INSERT INTO address_orders(request_no,user_id,status) VALUES(?,?,'queued')").run(requestNo,user.id);
    return Response.json({requestNo},{status:202});
  }};
  let clock = Date.now();
  const wallet = createWallet(db);
  wallet.credit({userId:user.id,amountRaw:500000,reference:'seed'});
  const billing = () => createAddressBilling({db,mf,wallet,now:()=>clock,config:{origin:'https://test.invalid',siteOrderQueueDirectory:directory,bindings:{RESOURCE_ADMIN_EMAILS:'boss@example.invalid,staff@example.invalid'}}});
  const payload = Buffer.from(JSON.stringify({template:{name:'Fixture'},profile:{fullName:'Fixture',addressLines:['a','b','c'],recipientEmail:'r@example.invalid'}}));
  const submit = async () => (await billing().submit(user,randomUUID(),payload,80000)).data.requestNo;
  const expired = await submit(), claimed = await submit(), interrupted = await submit();
  await rename(path.join(directory,claimed,'pending.json'),path.join(directory,claimed,'processing.json'));
  const status = no => db.prepare('SELECT status FROM address_orders WHERE request_no=?').get(no).status;
  assert.equal(JSON.parse(await readFile(path.join(directory,expired,'pending.json'),'utf8')).claimDeadlineMs,undefined);
  clock += 240000;
  const heart = path.join(directory,'.consumer-heartbeat');
  await writeFile(heart,'');
  await utimes(heart,new Date(clock),new Date(clock));
  await billing().sync();
  assert.equal(status(expired),'queued');
  await rename(path.join(directory,interrupted,'pending.json'),path.join(directory,interrupted,'billing-unclaimed-timeout.json'));
  clock += 190000;
  await Promise.all([billing().sync(),billing().sync()]);
  assert.equal(status(expired),'failed'); assert.equal(status(interrupted),'failed');
  assert.equal(status(claimed),'queued'); assert.equal(wallet.balance(user.id),260000);
  const billId = no => db.prepare('SELECT id FROM address_bills WHERE request_no=?').get(no).id;
  const owner = {id:'boss',email:'boss@example.invalid',role:'employee'};
  const review = () => billing().decideRefund(owner,billId(expired),'approved','已核实程序停止');
  for (const subject of [user,{id:'staff',email:'staff@example.invalid',role:'employee'}])
    await assert.rejects(billing().decideRefund(subject,billId(expired),'approved','测试'),{status:403});
  await Promise.all([review(),review()]); await billing().sync();
  assert.equal(wallet.balance(user.id),340000);
  await billing().decideRefund(owner,billId(interrupted),'declined','核对后不予退款');
  await assert.rejects(billing().decideRefund(owner,billId(interrupted),'approved','重复操作'),{status:409});
  assert.equal(wallet.balance(user.id),340000);
  const records=db.prepare("SELECT decision,actor FROM address_refund_reviews ORDER BY decision").all();
  assert.deepEqual(records.map(r=>[r.decision,r.actor]),[['approved','boss'],['declined','boss']]);
  await processSiteQueue(directory,async()=>assert.fail('parked jobs must not run'));
  // A missing callback opens a case, and a later delivery ends it without issuing a refund.
  const late = await submit();
  const staleAt = new Date(clock - 11 * 60_000).toISOString();
  const stale = db.prepare("UPDATE address_orders SET status='filling',updated_at=? WHERE request_no=?");
  await rename(path.join(directory,late,'pending.json'),path.join(directory,late,'processing.json'));
  stale.run(staleAt,late);
  await billing().sync();
  const decision = no => db.prepare('SELECT decision FROM address_refund_reviews WHERE bill_id=?').get(billId(no)).decision;
  assert.equal(decision(late),'pending');
  await assert.rejects(billing().decideRefund(owner,billId(late),'approved','仍在执行'),{status:409});
  db.prepare("UPDATE address_orders SET status='delivered' WHERE request_no=?").run(late);
  await billing().sync();
  assert.equal(decision(late),'delivered');
  assert.equal(wallet.balance(user.id),260000);

  // A stopped, stale job with no payment or delivery evidence can be closed by its reviewer.
  const stopped = await submit();
  await rename(path.join(directory,stopped,'pending.json'),path.join(directory,stopped,'failed-payload.json'));
  stale.run(staleAt,stopped);
  await billing().sync();
  assert.equal(decision(stopped),'pending');
  await billing().decideRefund(owner,billId(stopped),'approved','已确认原任务停止且未付款');
  assert.equal(status(stopped),'failed');
  assert.equal(wallet.balance(user.id),260000);
  const failed = await submit();
  await billing().reviewFailure(failed);
  assert.equal(db.prepare('SELECT 1 FROM address_refund_reviews WHERE bill_id=?').get(billId(failed)),undefined);
  db.prepare("UPDATE address_orders SET status='failed' WHERE request_no=?").run(failed);
  await billing().reviewFailure(failed);
  assert.equal(decision(failed),'pending');
  await billing().reviewFailure(failed);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM address_refund_reviews WHERE bill_id=?').get(billId(failed)).n,1);
  assert.equal(wallet.balance(user.id),180000);

});
