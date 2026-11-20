import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { passwordRecord } from './auth.mjs';

const day = 86400_000;
const lifetime = 30 * day;
const hash = value => createHash('sha256').update(value).digest('hex');

export function openIdentityStore(root) {
  const usersPath = path.join(root, 'config', 'accounts.json');
  const store = new DatabaseSync(path.join(root, 'data', 'site-sessions.sqlite'));
  store.exec(`CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, password_version TEXT NOT NULL, expires INTEGER NOT NULL
  ); CREATE TABLE IF NOT EXISTS employees (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, password TEXT NOT NULL
  )`);
  const list = () => [
    ...JSON.parse(readFileSync(usersPath, 'utf8')),
    ...store.prepare('SELECT id,email,name,password FROM employees ORDER BY name').all().map(row => ({ ...row, password:JSON.parse(row.password), enabled:true })),
  ];
  const version = user => hash(JSON.stringify(user.password));
  const remove = token => { if (/^[a-f0-9]{64}$/.test(token || '')) store.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(token)); };
  const cookie = token => `__Host-lumen_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${token ? lifetime / 1000 : 0}`;
  function issue(user) {
    const token = randomBytes(32).toString('hex');
    store.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(hash(token), user.id, version(user), Date.now() + lifetime);
    return cookie(token);
  }
  function lookup(token) {
    if (!/^[a-f0-9]{64}$/.test(token || '')) return null;
    const key = hash(token);
    const row = store.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires>?').get(key, Date.now());
    if (!row) return null;
    const user = list().find(account => account.id === row.user_id && account.enabled !== false);
    if (!user || version(user) !== row.password_version) { remove(token); return null; }
    let refreshCookie;
    if (row.expires <= Date.now() + lifetime - day) {
      store.prepare('UPDATE sessions SET expires=? WHERE token_hash=?').run(Date.now() + lifetime, key);
      refreshCookie = cookie(token);
    }
    return { user, refreshCookie };
  }
  function create({ email, name, password } = {}) {
    email = typeof email === 'string' ? email.trim().toLowerCase() : '';
    name = typeof name === 'string' ? name.trim() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !name || name.length > 80 || typeof password !== 'string' || password.length < 12 || password.length > 128) {
      return { status: 400, error: '请填写有效邮箱、姓名及 12–128 位密码。' };
    }
    const accounts = list();
    if (accounts.some(account => account.email.toLowerCase() === email)) return { status: 409, error: '这个邮箱已有账号。' };
    const account = { id: randomUUID(), email, name, enabled: true };
    store.prepare('INSERT INTO employees VALUES (?,?,?,?)').run(account.id,email,name,JSON.stringify(passwordRecord(password)));
    return { status: 201, account };
  }
  return { list, issue, lookup, remove, cookie, create, cleanup: () => store.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now()) };
}
