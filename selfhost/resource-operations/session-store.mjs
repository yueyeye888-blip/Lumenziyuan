import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { passwordRecord } from './auth.mjs';
import { registrationStore } from '../registration.mjs';

const day = 86400_000;
const lifetime = 30 * day;
const hash = value => createHash('sha256').update(value).digest('hex');

export function openIdentityStore(root, { config = {}, outlook, now } = {}) {
  const usersPath = path.join(root, 'config', 'accounts.json');
  const store = new DatabaseSync(path.join(root, 'data', 'site-sessions.sqlite'));
  store.exec(`CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, password_version TEXT NOT NULL, expires INTEGER NOT NULL
  ); CREATE TABLE IF NOT EXISTS employees (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, password TEXT NOT NULL
  ); CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, password TEXT NOT NULL
  )`);
  const configured = () => JSON.parse(readFileSync(usersPath, 'utf8'));
  const allStored = store.prepare(`SELECT id,email,name,password,'employee' AS role FROM employees
    UNION ALL SELECT id,email,name,password,'customer' AS role FROM customers ORDER BY name`);
  const storedEmail = store.prepare(`SELECT id,email,name,password,'employee' AS role FROM employees WHERE email=?
    UNION ALL SELECT id,email,name,password,'customer' AS role FROM customers WHERE email=?`);
  const storedId = store.prepare(`SELECT id,email,name,password,'employee' AS role FROM employees WHERE id=?
    UNION ALL SELECT id,email,name,password,'customer' AS role FROM customers WHERE id=?`);
  const unpack = row => row && ({ ...row, password: JSON.parse(row.password), enabled: true });
  const list = () => [...configured(), ...allStored.all().map(unpack)];
  const byEmail = email => configured().find(account => account.email.toLowerCase() === email)
    || unpack(storedEmail.get(email, email));
  const byId = id => configured().find(account => account.id === id) || unpack(storedId.get(id, id));
  function insertCustomer(email, password) {
    const account = { id: randomUUID(), email, name: email.split('@')[0].slice(0,80), role: 'customer', enabled: true,
      password: passwordRecord(password) };
    store.prepare('INSERT INTO customers VALUES (?,?,?,?)').run(account.id,email,account.name,JSON.stringify(account.password));
    return account;
  }
  const registration = registrationStore({ db: store, config, byEmail, insertCustomer, outlook, now });
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
    const user = byId(row.user_id);
    if (!user || user.enabled === false || version(user) !== row.password_version) { remove(token); return null; }
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
    if (byEmail(email)) return { status: 409, error: '这个邮箱已有账号。' };
    const account = { id: randomUUID(), email, name, enabled: true };
    store.prepare('INSERT INTO employees VALUES (?,?,?,?)').run(account.id,email,name,JSON.stringify(passwordRecord(password)));
    return { status: 201, account };
  }
  function cleanup() {
    store.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());
    registration.cleanup();
  }
  return { list, byEmail, issue, lookup, remove, cookie, create, registration, cleanup, close: () => store.close() };
}
