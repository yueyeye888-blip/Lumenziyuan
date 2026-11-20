import { randomUUID } from 'node:crypto';
import { fault } from './wallet.mjs';
import { discountedPrice } from './pricing.mjs';

export const downloadPriceRaw = 50000;
export const downloadPriceFor = user => discountedPrice(downloadPriceRaw, user);
const windowMs = 30 * 60_000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createArchiveDownloads({ db, wallet, now = Date.now }) {
  db.exec(`CREATE TABLE IF NOT EXISTS archive_downloads (
    receipt TEXT PRIMARY KEY, user_id TEXT NOT NULL, request_id TEXT NOT NULL,
    item_id TEXT NOT NULL, digest TEXT NOT NULL, bytes INTEGER NOT NULL,
    state TEXT NOT NULL, next_byte INTEGER NOT NULL DEFAULT 0, expires INTEGER NOT NULL,
    UNIQUE(user_id, request_id));
    CREATE TABLE IF NOT EXISTS archive_download_requests (
      user_id TEXT NOT NULL, request_id TEXT NOT NULL, receipt TEXT NOT NULL,
      PRIMARY KEY(user_id,request_id));
    CREATE INDEX IF NOT EXISTS archive_downloads_expiry ON archive_downloads(state,expires);
    CREATE INDEX IF NOT EXISTS archive_downloads_owner ON archive_downloads(user_id,item_id,state);`);
  const inFlight = new Set();
  const dbRow = db.prepare('SELECT * FROM archive_downloads WHERE receipt=?');
  const findRequest = db.prepare(`SELECT * FROM archive_downloads WHERE user_id=? AND (
    request_id=? OR receipt=(SELECT receipt FROM archive_download_requests WHERE user_id=? AND request_id=?))
    LIMIT 1`);
  const rememberRequest = db.prepare('INSERT INTO archive_download_requests VALUES(?,?,?)');
  const expired = (row) => row.expires <= now() && !inFlight.has(row.receipt);
  const key = (receipt) => 'template-download:' + receipt;
  function expire() {
    wallet.atomic(() => {
      for (const row of db
        .prepare("SELECT receipt,user_id FROM archive_downloads WHERE state='reserved' AND expires<=?")
        .all(now())) {
        wallet.release(row.user_id, key(row.receipt));
        db.prepare("UPDATE archive_downloads SET state='expired' WHERE receipt=?").run(row.receipt);
      }
    });
  }
  function authorize(userId, item, requestId, priceRaw = downloadPriceRaw) {
    if (!uuid.test(requestId || '')) throw fault(400, '下载请求编号无效，请重新打开确认窗口。');
    return wallet.atomic(() => {
      expire();
      const prior = findRequest.get(userId, requestId, userId, requestId);
      if (prior && (prior.item_id !== item.id || prior.digest !== item.sha256))
        throw fault(409, '这个请求已用于其他文件。');
      if (prior && (expired(prior) || ['complete', 'expired'].includes(prior.state)))
        throw fault(409, '上次下载已结束，请重新确认下载。');
      if (prior) return prior.receipt;
      const active = db
        .prepare(
          `SELECT * FROM archive_downloads WHERE user_id=? AND item_id=? AND digest=?
        AND state IN ('started','reserved') ORDER BY expires DESC LIMIT 1`,
        )
        .get(userId, item.id, item.sha256);
      if (active && !expired(active)) {
        const hold = db.prepare('SELECT amount FROM wallet_holds WHERE reference=?').get(key(active.receipt));
        if (active.state === 'reserved' && hold?.amount !== priceRaw) {
          throw fault(409, '这份文件已有按上次售价确认的下载，请继续原下载，或待其到期后再试。');
        }
        // A delayed retry of either authorization must still point to this same download.
        rememberRequest.run(userId, requestId, active.receipt);
        return active.receipt;
      }
      const receipt = randomUUID();
      wallet.reserve(userId, key(receipt), priceRaw);
      db.prepare(
        "INSERT INTO archive_downloads(receipt,user_id,request_id,item_id,digest,bytes,state,expires) VALUES(?,?,?,?,?,?,'reserved',?)",
      ).run(receipt, userId, requestId, item.id, item.sha256, item.bytes, now() + windowMs);
      return receipt;
    });
  }
  function check(userId, item, receipt) {
    if (!uuid.test(receipt || '')) throw fault(402, '请先确认价格并支付，再下载原文件。');
    const row = dbRow.get(receipt);
    if (!row || row.user_id !== userId || row.item_id !== item.id || row.digest !== item.sha256)
      throw fault(403, '下载凭证与当前账号或文件不符。');
    if (['complete', 'expired'].includes(row.state) || expired(row))
      throw fault(410, '本次下载已结束，请重新确认。');
    return row;
  }
  function begin(userId, item, receipt, start) {
    const row = check(userId, item, receipt);
    if (inFlight.has(receipt)) throw fault(409, '此文件正在下载。');
    // Accept contiguous ranges and retries from an earlier byte, never a standalone suffix that could finish a new receipt.
    if (start > row.next_byte) throw fault(416, '请从上次下载位置或文件开头继续。');
    wallet.atomic(() => {
      if (row.state === 'reserved')
        wallet.capture(userId, key(receipt), '模版下载 · ' + (item.displayTitle || item.name || item.id));
      db.prepare("UPDATE archive_downloads SET state='started',expires=? WHERE receipt=?").run(
        now() + windowMs,
        receipt,
      );
    });
    inFlight.add(receipt);
  }
  function end(receipt, nextByte) {
    try {
      const row = dbRow.get(receipt);
      if (row?.state === 'started') {
        const position = Math.min(row.bytes, Math.max(row.next_byte, nextByte));
        db.prepare('UPDATE archive_downloads SET next_byte=?, state=?, expires=? WHERE receipt=?').run(
          position,
          position === row.bytes ? 'complete' : 'started',
          now() + windowMs,
          receipt,
        );
      }
    } finally {
      inFlight.delete(receipt);
    }
  }
  return { authorize, check, begin, end, expire };
}
