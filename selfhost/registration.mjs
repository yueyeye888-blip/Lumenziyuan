import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

const minute = 60_000;
const hour = 60 * minute;
const validEmail = email => typeof email === 'string' && email.length <= 254 && /^[^\s@,;<>\x00-\x1f\x7f]+@[^\s@,;<>\x00-\x1f\x7f]+\.[^\s@,;<>\x00-\x1f\x7f]+$/.test(email);
const normalize = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const accepted = { status: 200, message: '如果此邮箱可以注册，验证码将发送至你的收件箱。请同时检查垃圾邮件。' };
const invalid = { status: 400, error: '验证码无效或已过期，请重新核对。' };
const limited = { status: 429, error: '验证码请求过于频繁，请稍后重试。' };
const unavailable = { status: 503, error: '验证码邮件暂时无法发送，请稍后重试。' };

export function clientAddress(req) {
  const peer = req.socket.remoteAddress || '';
  if (['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer)) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').at(-1).trim();
    if (isIP(forwarded)) return forwarded;
  }
  return peer;
}

export function reservedPublicEmail(config, email) {
  return [...String(config.bindings?.RESOURCE_ADMIN_EMAILS || '').split(','), config.archiveOwnerEmail]
    .some(value => typeof value === 'string' && normalize(value) === normalize(email));
}

// Share the identity transaction so that an OTP is consumed exactly when its account is created.
export function registrationStore({ db, config, byEmail, insertCustomer, outlook, now = Date.now }) {
  const key = Buffer.from(config.bindings?.SETTINGS_ENCRYPTION_KEY || '', 'base64');
  const digest = (...values) => createHmac('sha256', key).update(JSON.stringify(values)).digest('hex');
  db.exec(`CREATE TABLE IF NOT EXISTS registration_challenges (
    email_key TEXT PRIMARY KEY, nonce TEXT NOT NULL, code_hash TEXT NOT NULL, expires INTEGER NOT NULL, attempts INTEGER NOT NULL
  ); CREATE TABLE IF NOT EXISTS registration_limits (
    key TEXT PRIMARY KEY, expires INTEGER NOT NULL, count INTEGER NOT NULL
  )`);
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (err) { db.exec('ROLLBACK'); throw err; }
  }
  function take(key, ttl, max, time) {
    const result = db.prepare(`INSERT INTO registration_limits VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET
      count = CASE WHEN expires <= ? THEN 1 ELSE count+1 END,
      expires = CASE WHEN expires <= ? THEN excluded.expires ELSE expires END
      WHERE expires <= ? OR count < ?`).run(key, time+ttl, time, time, time, max);
    return result.changes === 1;
  }
  async function requestCode(input, ip) {
    const email = normalize(input);
    if (!validEmail(email)) return { status: 400, error: '请输入有效邮箱。' };
    if (!outlook || key.length !== 32) return unavailable;
    const time = now();
    const emailKey = digest('email', email);
    const code = String(randomInt(1_000_000)).padStart(6, '0');
    const nonce = randomUUID();
    const reserved = transaction(() => {
      if (!take(digest('ip', ip), hour, 25, time) || !take(digest('pause', email), minute, 1, time)
          || !take(digest('mail', email), hour, 5, time)) return limited;
      if (reservedPublicEmail(config, email) || byEmail(email)) return accepted;
      if (!take('site', hour, 150, time)) return limited;
      db.prepare('INSERT OR REPLACE INTO registration_challenges VALUES (?,?,?,?,0)')
        .run(emailKey, nonce, digest('code', emailKey, nonce, code), time+10*minute);
    });
    if (reserved) return reserved;
    try { await outlook.sendRegistrationCode(email, code); }
    catch {
      db.prepare('DELETE FROM registration_challenges WHERE email_key=? AND nonce=?').run(emailKey, nonce);
      return unavailable;
    }
    return accepted;
  }
  function register({ email: input, code, password }) {
    const email = normalize(input);
    if (!validEmail(email) || typeof code !== 'string' || !/^\d{6}$/.test(code) || key.length !== 32) return invalid;
    if (typeof password !== 'string' || password.length < 12 || password.length > 128) return { status: 400, error: '登录密码须为 12–128 位。' };
    return transaction(() => {
      const emailKey = digest('email', email);
      const row = db.prepare('SELECT * FROM registration_challenges WHERE email_key=?').get(emailKey);
      if (!row || row.expires <= now() || row.attempts >= 5 || byEmail(email) || reservedPublicEmail(config, email)) return invalid;
      if (!timingSafeEqual(Buffer.from(row.code_hash, 'hex'), Buffer.from(digest('code', emailKey, row.nonce, code), 'hex'))) {
        db.prepare('UPDATE registration_challenges SET attempts=attempts+1 WHERE email_key=?').run(emailKey);
        return invalid;
      }
      const account = insertCustomer(email, password);
      db.prepare('DELETE FROM registration_challenges WHERE email_key=?').run(emailKey);
      return { status: 201, account };
    });
  }
  function cleanup() {
    const time = now();
    db.prepare('DELETE FROM registration_challenges WHERE expires<=?').run(time);
    db.prepare('DELETE FROM registration_limits WHERE expires<=?').run(time);
  }
  return { requestCode, register, cleanup };
}

const customerGet = new Set(['/api/esim/packages','/api/esim/purchases','/api/esim/purchase-cards','/api/esim/renewals']);
const customerPost = new Set(['/api/esim/purchase-quote','/api/esim/purchases','/api/settings/security','/api/esim/renewal-quote','/api/esim/renewals']);
export function customerEsimRoute(method, pathname) {
  return method === 'GET' && customerGet.has(pathname) || method === 'POST' && customerPost.has(pathname);
}
