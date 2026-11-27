import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const delivery = {
  accepted:{code:'accepted',tone:'info',label:'邮件服务已接受',detail:'Outlook 已接受发送请求，请在接收邮箱查看 Excel 附件。'},
  failed:{code:'failed',tone:'error',label:'发送失败',detail:'Outlook 未接受发送，或发件授权不可用。'},
  unknown:{code:'unknown',tone:'warning',label:'发送结果待确认',detail:'请先检查接收邮箱及垃圾邮箱，避免重复发送。'},
};
export const normalizeRecipient = value => typeof value === 'string' && value.trim().length <= 254 && /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(value.trim()) ? value.trim() : null;

export function openEsimMailLog(root) {
  const db = new DatabaseSync(path.join(root,'data','site-esim-mail.sqlite'));
  db.exec(`CREATE TABLE IF NOT EXISTS esim_mail (
    user_id TEXT NOT NULL, request_id TEXT NOT NULL, account TEXT NOT NULL, recipient TEXT NOT NULL,
    selection_hash TEXT NOT NULL, item_count INTEGER NOT NULL, qr_count INTEGER NOT NULL,
    status TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL, updated_at TEXT,
    PRIMARY KEY (user_id, request_id)
  )`);
  if (!db.prepare('PRAGMA table_info(esim_mail)').all().some(column => column.name === 'updated_at')) {
    // Older rows have no result timestamp, so leave it NULL rather than treating creation time as a result time.
    db.exec('ALTER TABLE esim_mail ADD COLUMN updated_at TEXT');
  }
  const find = db.prepare('SELECT * FROM esim_mail WHERE user_id=? AND request_id=?');
  const insert = db.prepare("INSERT INTO esim_mail (user_id,request_id,account,recipient,selection_hash,item_count,qr_count,status,error,created_at) VALUES (?,?,?,?,?,?,?,'pending',NULL,?)");
  const update = db.prepare('UPDATE esim_mail SET status=?, error=?, updated_at=? WHERE user_id=? AND request_id=?');
  const all = db.prepare('SELECT * FROM esim_mail ORDER BY COALESCE(updated_at,created_at) DESC LIMIT 250');
  const own = db.prepare('SELECT * FROM esim_mail WHERE user_id=? ORDER BY COALESCE(updated_at,created_at) DESC LIMIT 250');

  function sendKey(user, requestId, recipient, ids) {
    const digest = createHash('sha256').update(JSON.stringify([recipient.toLowerCase(),[...ids].sort()])).digest('hex');
    return { user, requestId, recipient, digest };
  }
  function lookup(key) {
    const row = find.get(key.user.id,key.requestId);
    if (!row) return null;
    if (row.selection_hash !== key.digest) return { httpStatus:409, data:{ error:'发送编号对应的收件人或选择已变化。' } };
    const status = row.status === 'pending' ? 'unknown' : row.status;
    return {
      httpStatus:status === 'accepted' ? 202 : status === 'unknown' ? 409 : 502,
      data:{ status, recipient:row.recipient, count:row.item_count, embedded:row.qr_count, error:row.error || (status === 'unknown' ? delivery.unknown.detail : undefined) },
    };
  }
  function list(user, isAdmin) {
    return (isAdmin ? all.all() : own.all(user.id)).map(row => ({
      id:`${row.user_id}:${row.request_id}`, kind:'esim_workbook', name:`eSIM 二维码 Excel（${row.item_count} 张）`,
      account:row.account, recipientEmail:row.recipient, createdAt:row.created_at, updatedAt:row.updated_at, error:row.error,
      delivery:delivery[row.status] || delivery.unknown,
    }));
  }
  return {
    sendKey, lookup, list,
    begin(key, count, embedded) { insert.run(key.user.id,key.requestId,key.user.email,key.recipient,key.digest,count,embedded,new Date().toISOString()); },
    finish(key, result) { update.run(result.status,result.error || null,new Date().toISOString(),key.user.id,key.requestId); },
    close() { db.close(); },
  };
}
