import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, rename, rm, access } from 'node:fs/promises';
import path from 'node:path';
import { orderNotice } from '../site-order-queue.mjs';
import { trustedHeaders } from '../auth.mjs';
import { fault } from './wallet.mjs';
import { discountedPrice } from './pricing.mjs';

export const addressPriceRaw = 100000;
export const addressPriceFor = user => discountedPrice(addressPriceRaw, user);
const orderPath = '/api/personal-details/submit';
const requestKey = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const reviewAfterMs = 10 * 60_000;
const consumed = ['pending.json', 'processing.json', 'done.json', 'completed-payload.json', 'failed-payload.json'];

export function createAddressBilling({ db, mf, wallet, config, now = Date.now }) {
  db.exec(`CREATE TABLE IF NOT EXISTS address_bills(
    id TEXT PRIMARY KEY, request_no TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL, payload_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL, state TEXT NOT NULL CHECK(state IN ('held','spent','released')));
    CREATE TABLE IF NOT EXISTS address_prepayments(
      bill_id TEXT PRIMARY KEY, settled INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS address_prepayments_open ON address_prepayments(bill_id) WHERE settled=0;
    CREATE TABLE IF NOT EXISTS address_queue_intents(
      bill_id TEXT PRIMARY KEY, state TEXT NOT NULL CHECK(state IN ('prepared','ready','published','discarded','review')));`);
  if (!db.prepare('PRAGMA table_info(address_prepayments)').all().some(column => column.name === 'amount_raw')) {
    db.exec(`ALTER TABLE address_prepayments ADD COLUMN amount_raw INTEGER NOT NULL DEFAULT ${addressPriceRaw}`);
  }
  const pending = new Set();
  const read = db.prepare('SELECT * FROM address_bills WHERE id=?');
  const queueIntent = db.prepare('SELECT state FROM address_queue_intents WHERE bill_id=?');
  const setQueueState = db.prepare('UPDATE address_queue_intents SET state=? WHERE bill_id=?');
  const prepayment = db.prepare('SELECT settled,amount_raw FROM address_prepayments WHERE bill_id=?');
  function paymentStatus(id) {
    const state = read.get(id).state;
    return state === 'released' ? 'refunded' : state === 'spent' ? 'paid' : 'reserved';
  }
  const directory = config.siteOrderQueueDirectory;
  const job = (bill, file) => path.join(directory, bill.request_no, file);
  const getOrder = async (bill) =>
    (await mf.getD1Database('DB'))
      .prepare('SELECT status FROM address_orders WHERE request_no=? AND user_id=?')
      .bind(bill.request_no, bill.user_id)
      .first();
  async function markBilledOrder(bill) {
    const d1 = await mf.getD1Database('DB');
    await d1.batch([
      d1.prepare(
        'CREATE TABLE IF NOT EXISTS billed_address_order_ids (request_no TEXT PRIMARY KEY,user_id TEXT NOT NULL)'
      ),
      d1.prepare(`CREATE TRIGGER IF NOT EXISTS protect_billed_address_final BEFORE UPDATE OF status ON address_orders
        WHEN OLD.status IN ('failed','delivered') AND NEW.status!=OLD.status AND EXISTS (
          SELECT 1 FROM billed_address_order_ids b WHERE b.request_no=OLD.request_no AND b.user_id=OLD.user_id
        ) BEGIN SELECT RAISE(ABORT,'lumen_billed_order_final'); END`),
      d1.prepare('INSERT INTO billed_address_order_ids VALUES(?,?)').bind(bill.request_no, bill.user_id),
    ]);
  }
  function finish(bill, state) {
    wallet.atomic(() => {
      const prepaid = prepayment.get(bill.id);
      if (prepaid) {
        if (prepaid.settled) return;
        if (state === 'released') {
          wallet.credit({ userId:bill.user_id, reference:'refund:'+bill.id, amountRaw:prepaid.amount_raw, note:'地址生成退款 · '+bill.request_no });
        }
        db.prepare('UPDATE address_prepayments SET settled=1 WHERE bill_id=?').run(bill.id);
        db.prepare('UPDATE address_bills SET state=? WHERE id=?').run(state,bill.id);
        return;
      }
      // Orders submitted before prepaid billing keep their original hold until delivery.
      if (read.get(bill.id).state !== 'held') return;
      if (state === 'released') wallet.release(bill.user_id, bill.id);
      else wallet.capture(bill.user_id, bill.id);
      db.prepare('UPDATE address_bills SET state=? WHERE id=?').run(state, bill.id);
    });
  }
  // Staged notices live only in the existing private queue, and are invisible to its consumer.
  async function stage(bill, payload, email) {
    let text;
    try {
      text = orderNotice(bill.request_no, JSON.parse(payload.toString()), email);
    } catch {
      throw fault(400, '资料格式无效，请核对后重新提交。');
    }
    await mkdir(directory, { recursive: true });
    await mkdir(path.join(directory, bill.request_no), { mode: 0o700 });
    await writeFile(
      job(bill, 'billing.tmp'),
      JSON.stringify({ requestNo: bill.request_no, text, createdAt: new Date(now()).toISOString() }),
      { flag: 'wx', mode: 0o600 }
    );
    await rename(job(bill, 'billing.tmp'), job(bill, 'billing-staged.json'));
  }
  async function discard(bill) {
    await rm(job(bill, 'billing.tmp'), { force: true });
    await rm(job(bill, 'billing-staged.json'), { force: true });
    setQueueState.run('discarded', bill.id);
  }
  async function review(bill) {
    const d1 = await mf.getD1Database('DB');
    await d1
      .prepare(
        "UPDATE address_orders SET status_message=?,updated_at=? WHERE request_no=? AND user_id=? AND status='queued'"
      )
      .bind(
        prepayment.get(bill.id) ? '已支付，提交结果待管理员核对。无需重复提交。' : '提交结果待管理员核对，余额已预留。无需重复提交。',
        new Date(now()).toISOString(),
        bill.request_no,
        bill.user_id
      )
      .run();
    setQueueState.run('review', bill.id);
  }
  async function publish(bill) {
    // Move the original staged file exactly once. A retry after consumption can only observe the old job.
    try {
      await rename(job(bill, 'billing-staged.json'), job(bill, 'pending.json'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      let known = false;
      for (const file of consumed) {
        try {
          await access(job(bill, file));
          known = true;
          break;
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      if (!known) {
        await review(bill);
        return;
      }
    }
    setQueueState.run('published', bill.id);
  }
  async function settle(bill) {
    const order = await getOrder(bill);
    const state = queueIntent.get(bill.id)?.state;
    const uncertain = !pending.has(bill.id) && now() - bill.created_at > reviewAfterMs;
    const terminal = order?.status === 'failed' || order?.status === 'delivered';
    if (terminal || (!order && uncertain)) {
      // Settling the balance is independent of cleanup permission/disk failures.
      finish(bill, order?.status === 'delivered' ? 'spent' : 'released');
      if (state && state !== 'discarded' && state !== 'published' && directory) await discard(bill);
    } else if (order?.status === 'queued' && directory) {
      if (state === 'ready') await publish(bill);
      else if (state === 'prepared' && uncertain) await review(bill);
    } else if (order && directory && ['prepared', 'ready', 'review'].includes(state)) {
      // The existing processor has confirmed later progress through its callback.
      await discard(bill);
    }
    return order;
  }
  async function sync() {
    let firstError;
    for (const bill of db
      .prepare(
        `SELECT b.* FROM address_bills b LEFT JOIN address_queue_intents q ON q.bill_id=b.id
      WHERE b.state='held' OR b.id IN (SELECT bill_id FROM address_prepayments WHERE settled=0) OR q.state IN ('prepared','ready','review') ORDER BY b.created_at`
      )
      .all()) {
      try {
        await settle(bill);
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError) throw firstError;
  }
  async function submit(user, key, payload, quotedPriceRaw) {
    if (!requestKey.test(key || '')) throw fault(400, '请刷新页面后重新发起本次订单。');
    const id = 'address:' + key,
      digest = createHash('sha256').update(payload).digest('hex');
    const prior = read.get(id);
    if (prior) {
      if (prior.user_id !== user.id || prior.payload_hash !== digest) throw fault(409, '订单编号与本次提交不符。');
      const order = await settle(prior);
      if (!order && read.get(id).state === 'released') throw fault(409, '上次请求未成立，金额已退回可用余额，请重新提交。');
      if (!order) throw fault(503, '正在核对上次提交，请稍后再查询。');
      return { status: 202, data: { ok: true, requestNo: prior.request_no, paymentStatus:paymentStatus(id), paidAmountRaw:prepayment.get(id)?.amount_raw ?? addressPriceRaw } };
    }
    const priceRaw = addressPriceFor(user);
    if ((quotedPriceRaw !== undefined || user.discountBps !== null && user.discountBps !== undefined) && quotedPriceRaw !== priceRaw) {
      throw fault(409, '售价已更新，请刷新页面查看金额后再确认付款。');
    }
    const requestNo =
      'ADDR-' +
      new Date(now()).toISOString().slice(0, 10).replaceAll('-', '') +
      '-' +
      randomUUID().slice(0, 8).toUpperCase();
    wallet.atomic(() => {
      wallet.reserve(user.id, id, priceRaw);
      wallet.capture(user.id,id,'地址生成 · '+requestNo);
      db.prepare('INSERT INTO address_prepayments(bill_id,amount_raw) VALUES(?,?)').run(id,priceRaw);
      db.prepare("INSERT INTO address_bills VALUES(?,?,?,?,?,'spent')").run(id, requestNo, user.id, digest, now());
      if (directory) db.prepare("INSERT INTO address_queue_intents VALUES(?,'prepared')").run(id);
    });
    const bill = read.get(id);
    pending.add(id);
    try {
      if (directory) {
        try {
          await stage(bill, payload, user.email);
        } catch (error) {
          finish(bill, 'released');
          // Never alter another job on the very unlikely order-number collision.
          if (error.code !== 'EEXIST') await discard(bill);
          else setQueueState.run('discarded', id);
          throw error;
        }
      }
      try {
        await markBilledOrder(bill);
      } catch (error) {
        finish(bill, 'released');
        if (directory) await discard(bill);
        throw error;
      }
      const headers = trustedHeaders({}, user);
      headers.set('content-type', 'application/json');
      headers.set('origin', config.origin);
      headers.set('x-lumen-billed-address-order', requestNo);
      const reply = await mf.dispatchFetch(new URL(orderPath, config.origin).href, {
        method: 'POST',
        headers,
        body: payload,
      });
      const result = await reply.json();
      if (reply.status >= 400 && reply.status < 500) {
        finish(bill, 'released');
        if (directory) await discard(bill);
        return { status: reply.status, data: result };
      }
      if (reply.status !== 202 || result.requestNo !== requestNo) throw fault(503, '正在核对订单，请稍后查看记录。');
      if (directory) setQueueState.run('ready', id);
      await settle(bill);
      return { status: 202, data: { ...result,paymentStatus:paymentStatus(id), paidAmountRaw:prepayment.get(id)?.amount_raw ?? addressPriceRaw } };
    } finally {
      pending.delete(id);
    }
  }
  return { sync, submit };
}
