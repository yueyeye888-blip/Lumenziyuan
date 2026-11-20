import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { passwordRecord } from './auth.mjs';

const fields = JSON.parse(readFileSync(0,'utf8').replace(/^\uFEFF/,''));
const address = new URL(fields.origin);
if (address.protocol !== 'https:' || address.pathname !== '/' || address.search || address.hash || address.username || address.password) {
  throw Error('origin must be an HTTPS site origin');
}
const email = String(fields.adminEmail || '').trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>254) throw Error('Invalid administrator email');
if (typeof fields.password !== 'string' || fields.password.length < 12 || fields.password.length > 128) {
  throw Error('The administrator password must be 12 to 128 characters');
}
const port = Number(fields.port ?? 8443);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid listen port');
if (existsSync('config/runtime.json') || existsSync('config/accounts.json') || existsSync('data/d1')) {
  throw Error('Existing site state detected. Use the migration instructions.');
}
for (const dir of ['config','data','logs']) mkdirSync(dir,{recursive:true,mode:0o700});
const config = {
  port, origin:address.origin, aliasOrigins:[],
  ...(fields.tlsPfxPassword ? {tlsPfxPassword:fields.tlsPfxPassword} : {}),
  bindings:{RESOURCE_ADMIN_EMAILS:email,SETTINGS_ENCRYPTION_KEY:randomBytes(32).toString('base64')},
};
const account = {id:randomUUID(), email, name:'资源管理员', enabled:true, password:passwordRecord(fields.password)};
const write = (path,value) => writeFileSync(path,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
write('config/runtime.json',config);
write('config/accounts.json',[account]);
console.log('Site configuration created.');
