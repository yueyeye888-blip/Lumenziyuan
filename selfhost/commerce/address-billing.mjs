import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm, access, stat } from 'node:fs/promises';
import path from 'node:path';
import { orderNotice } from '../site-order-queue.mjs';
import { trustedHeaders } from '../auth.mjs';
import { canManageAccounts } from '../resource-operations/account-access.mjs';
import { fault } from './wallet.mjs';
import { discountedPrice } from './pricing.mjs';

export const addressPriceRaw = 100000;
export const addressPriceFor = user => discountedPrice(addressPriceRaw, user);
const orderPath = '/api/personal-details/submit';
const requestKey = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const claimWindowMs = 3 * 60_000;
const timeoutFile = 'billing-unclaimed-timeout.json';
const reviewAfterMs = 10 * 60_000;
const consumed = [timeoutFile, 'pending.json', 'processing.json', 'done.json', 'completed-payload.json', 'failed-payload.json'];

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
  db.exec(`CREATE TABLE IF NOT EXISTS address_refund_reviews (
    bill_id TEXT PRIMARY KEY, reason TEXT NOT NULL, opened_at INTEGER NOT NULL,
    decision TEXT NOT NULL DEFAULT 'pending', actor TEXT, decision_note TEXT, decided_at INTEGER)`);
  const refundReview = db.prepare('SELECT * FROM address_refund_reviews WHERE bill_id=?');
  const pending = new Set();
  const reviewInProgress = new Map();
  const read = db.prepare('SELECT * FROM address_bills WHERE id=?');
  const queueIntent = db.prepare('SELECT state FROM address_queue_intents WHERE bill_id=?');
  const setQueueState = db.prepare('UPDATE address_queue_intents SET state=? WHERE bill_id=?');
  const prepayment = db.prepare('SELECT settled,amount_raw FROM address_prepayments WHERE bill_id=?');
  function paymentStatus(id) {
    if (refundReview.get(id)?.decision === 'pending') return 'review';
    const state = read.get(id).state;
    return state === 'released' ? 'refunded' : state === 'spent' ? 'paid' : 'reserved';
  }
  const directory = config.siteOrderQueueDirectory;
  const job = (bill, file) => path.join(directory, bill.request_no, file);
  const getOrder = async (bill) =>
    (await mf.getD1Database('DB'))
      .prepare('SELECT status, updated_at, external_order_no, payment_amount FROM address_orders WHERE request_no=? AND user_id=?')
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
  async function expireUnclaimed(bill) {
    // The worker claims by renaming the very same source. Only one rename can succeed.
    // The marker also lets reconciliation finish a cancellation interrupted by a restart.
    try {
      await rename(job(bill, 'pending.json'), job(bill, timeoutFile));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      try {
        await access(job(bill, timeoutFile));
      } catch (missing) {
        if (missing.code === 'ENOENT') return;
        throw missing;
      }
    }
    const d1 = await mf.getD1Database('DB');
    const result = await d1.prepare(`UPDATE address_orders
      SET status='failed', status_message=?, error=?, updated_at=?
      WHERE request_no=? AND user_id=? AND status='queued'
        AND external_order_no IS NULL AND payment_amount IS NULL`)
      .bind('接单程序无响应，等待人工复核', '接单程序无响应，订单已停止。退款结果可在客服中心查看。',
        new Date(now()).toISOString(), bill.request_no, bill.user_id).run();
    if (result.meta.changes === 1) requestReview(bill, '接单程序超过 3 分钟无响应，原订单已撤出队列');
  }
  function requestReview(bill, reason) {
    const prepaid = prepayment.get(bill.id);
    if (prepaid ? prepaid.settled : read.get(bill.id)?.state !== 'held') return;
    db.prepare('INSERT OR IGNORE INTO address_refund_reviews(bill_id,reason,opened_at) VALUES(?,?,?)')
      .run(bill.id,reason,now());
  }
  async function workerUnavailable() {
    try { return now() - (await stat(path.join(directory,'.consumer-heartbeat'))).mtimeMs > claimWindowMs; }
    catch (error) { if (error.code === 'ENOENT') return true; throw error; }
  }
  async function decideRefund(user, id, decision, note) {
    if (!canManageAccounts(config,user)) throw fault(403,'仅平台所有者可以复核退款。');
    if (!['approved','declined'].includes(decision) || !note?.trim() || note.length > 500)
      throw fault(400,'请选择复核结果并填写说明。');
    const bill = read.get(id);
    const review = refundReview.get(id);
    if (!bill || !review) throw fault(404,'未找到复核记录。');
    if (review.decision === decision) return;
    if (review.decision !== 'pending') throw fault(409,'该记录已经复核。');
    const current = reviewInProgress.get(id);
    if (current) {
      if (current.decision !== decision) throw fault(409,'该记录正在复核。');
      return current.result;
    }
    const result = completeReview(user, bill, decision, note);
    reviewInProgress.set(id, {decision, result});
    try { await result; } finally { reviewInProgress.delete(id); }
  }
  async function stopStalledOrder(bill) {
    const order = await getOrder(bill);
    if (directory) {
      for (const name of ['pending.json','processing.json','billing-staged.json']) {
        try { await access(job(bill,name)); }
        catch (error) { if (error.code === 'ENOENT') continue; throw error; }
        throw fault(409,'原订单仍可执行，请先核对处理队列。');
      }
    }
    if (order && order.status !== 'failed') {
      const rawTime = order.updated_at || '';
      const last = Date.parse(rawTime.includes('T') ? rawTime : rawTime.replace(' ','T') + 'Z');
      if (order.status === 'delivered' || order.external_order_no || order.payment_amount ||
          !Number.isFinite(last) || now() - last <= reviewAfterMs || !directory) {
        throw fault(409,'订单仍在处理、已生成上游单号或已交付。请先核实上游并结束异常任务。');
      }
      // Financial and delivery records can precede a lost site callback.
      const data = path.dirname(directory);
      const load = async (name) => {
        try { return JSON.parse(await readFile(path.join(data,name),'utf8')); }
        catch(error) { if(error.code==='ENOENT') return {}; throw error; }
      };
      const ledger = await load('payment-ledger.json');
      const delivery = await load('outlook-delivery-jobs.json');
      if (Object.values(ledger.entries || {}).some(x=>x.requestNo===bill.request_no)
          || (delivery.jobs || []).some(x=>x.requestNo===bill.request_no))
        throw fault(409,'已有上游付款或交付记录，请先核实处理结果。');
      const d1 = await mf.getD1Database('DB');
      const result = await d1.prepare(`UPDATE address_orders SET status='failed',status_message=?,error=?,updated_at=?
        WHERE request_no=? AND user_id=? AND status=? AND updated_at=? AND external_order_no IS NULL AND payment_amount IS NULL`)
        .bind('程序异常，订单已停止','请在客服中心查看复核结果。',new Date(now()).toISOString(),
          bill.request_no,bill.user_id,order.status,order.updated_at).run();
      if (!result.meta.changes) throw fault(409,'订单已有新进展，请刷新后核对。');
    }
  }
  async function completeReview(user, bill, decision, note) {
    const id = bill.id;
    if (decision === 'approved') await stopStalledOrder(bill);
    wallet.atomic(() => {
      const current = refundReview.get(id);
      if (current.decision === decision) return;
      if (current.decision !== 'pending') throw fault(409,'该记录已经复核。');
      finish(bill, decision === 'approved' ? 'released' : 'spent');
      db.prepare('UPDATE address_refund_reviews SET decision=?, actor=?, decision_note=?, decided_at=? WHERE bill_id=?')
        .run(decision,user.id,note.trim(),now(),id);
    });
  }
  async function settle(bill) {
    const order = await getOrder(bill);
    const state = queueIntent.get(bill.id)?.state;
    const uncertain = !pending.has(bill.id) && now() - bill.created_at > reviewAfterMs;
    // An interrupted acknowledgement after claim also merits investigation.
    // Recording a case never credits funds or replays the job.
    if (order && !['failed','delivered'].includes(order.status)) {
      const changed = order.updated_at?.includes('T') ? Date.parse(order.updated_at)
        : Date.parse((order.updated_at || '').replace(' ','T') + 'Z');
      if (now() - (Number.isFinite(changed) ? changed : bill.created_at) > reviewAfterMs) {
        if (order.status !== 'queued') requestReview(bill,'处理回执超过 10 分钟未更新，请核查执行和交付记录');
        else if (directory) {
          try { await access(job(bill,'processing.json')); requestReview(bill,'已领取订单长时间没有开始处理的回执'); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
      }
    }
    const terminal = order?.status === 'failed' || order?.status === 'delivered';
    if (terminal || (!order && uncertain)) {
      // Settling the balance is independent of cleanup permission/disk failures.
      if (order?.status === 'delivered') {
        wallet.atomic(() => {
          finish(bill,'spent');
          db.prepare("UPDATE address_refund_reviews SET decision='delivered',decided_at=? WHERE bill_id=? AND decision='pending'").run(now(),bill.id);
        });
      } else requestReview(bill,order?.status === 'failed' ? '处理失败，请核实是否为程序故障' : '提交结果长时间无法确认');
      if (state && state !== 'discarded' && state !== 'published' && directory) await discard(bill);
    } else if (order?.status === 'queued' && directory) {
      if (state === 'ready') await publish(bill);
      if (queueIntent.get(bill.id)?.state === 'published' && now() - bill.created_at > claimWindowMs
          && !order.external_order_no && !order.payment_amount && await workerUnavailable()) {
        await expireUnclaimed(bill);
        return getOrder(bill);
      }
      if (['prepared','review'].includes(state) && uncertain) {
        await review(bill);
        const d1 = await mf.getD1Database('DB');
        await d1.prepare("UPDATE address_orders SET status='failed', status_message=?, updated_at=? WHERE request_no=? AND user_id=? AND status='queued' AND external_order_no IS NULL")
          .bind('提交未确认，等待人工复核',new Date(now()).toISOString(),bill.request_no,bill.user_id).run();
        await discard(bill);
        requestReview(bill,'上游提交未确认');
      }
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
      if (!order && refundReview.get(id)) throw fault(409,'订单提交异常，复核结果请在客服中心查看。');
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
          requestReview(bill,'订单资料入队失败');
          // Never alter another job on the very unlikely order-number collision.
          if (error.code !== 'EEXIST') await discard(bill);
          else setQueueState.run('discarded', id);
          throw error;
        }
      }
      try {
        await markBilledOrder(bill);
      } catch (error) {
        requestReview(bill,'订单提交失败');
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
        requestReview(bill,'订单提交失败');
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
  async function reviewFailure(requestNo) {
    const bill = db.prepare('SELECT * FROM address_bills WHERE request_no=?').get(requestNo);
    if (bill && (await getOrder(bill))?.status === 'failed') requestReview(bill,'处理失败，请核实是否为程序故障');
  }
  return { sync, submit, decideRefund, reviewFailure };
}
