import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { decryptMailToken, encryptMailToken } from './outlook-mail.mjs';

const base = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const credentialsPath = 'data/outlook-mail-credentials.json';
const statePath = 'config/outlook-site-oauth-recovery.json';
const config = JSON.parse(readFileSync('config/runtime.json','utf8'));
const saved = existsSync(credentialsPath) ? JSON.parse(readFileSync(credentialsPath,'utf8')) : {};
const clientId = config.outlook?.clientId || saved.clientId;
const target = String(config.outlook?.mailbox || saved.mailbox || '').trim().toLowerCase();
const key = config.bindings?.SETTINGS_ENCRYPTION_KEY;
if (!clientId || !/^[^\s@]+@[^\s@]+$/.test(target) || Buffer.from(key || '', 'base64').length !== 32) {
  throw Error('Set outlook.mailbox, outlook.clientId and bindings.SETTINGS_ENCRYPTION_KEY in config/runtime.json');
}
const tokenTag = saved.refreshToken?.tag || null;
const send = (route, body) => fetch(`${base}/${route}`, { method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,...body}),signal:AbortSignal.timeout(15000) });
function writeJson(file, data) {
  const pending = `${file}.${randomUUID()}.tmp`;
  writeFileSync(pending,JSON.stringify(data),{flag:'wx',mode:0o600});
  renameSync(pending,file);
}

if (process.argv[2] === 'start') {
  const response = await send('devicecode',{scope:'offline_access User.Read Mail.Send'});
  const result = await response.json();
  if (!response.ok) { console.log(JSON.stringify({status:'failed',error:result.error,codes:result.error_codes})); process.exit(0); }
  if (!result.device_code || !result.user_code || !['microsoft.com','www.microsoft.com','login.microsoftonline.com'].includes(new URL(result.verification_uri).hostname)) throw Error('Unexpected verification response');
  const expires = Date.now() + result.expires_in * 1000;
  writeJson(statePath,{ encrypted:encryptMailToken(result.device_code,key),expires,clientId,previous:tokenTag });
  console.log(JSON.stringify({status:'ready',code:result.user_code,url:result.verification_uri,expires:new Date(expires).toISOString()}));
} else if (process.argv[2] === 'poll') {
  if (!existsSync(statePath)) { console.log(JSON.stringify({status:'no_request'})); process.exit(0); }
  const state = JSON.parse(readFileSync(statePath,'utf8'));
  if (state.clientId !== clientId || state.previous !== tokenTag) throw Error('Mailbox configuration changed while verifying authorization');
  if (state.expires <= Date.now()) { unlinkSync(statePath); console.log(JSON.stringify({status:'expired'})); process.exit(0); }
  const response = await send('token',{grant_type:'urn:ietf:params:oauth:grant-type:device_code',device_code:decryptMailToken(state.encrypted,key)});
  const result = await response.json();
  if (!response.ok) { console.log(JSON.stringify({status:result.error,codes:result.error_codes})); process.exit(0); }
  if (!result.access_token || !result.refresh_token || !/\bMail\.Send\b/i.test(result.scope || '')) throw Error('Microsoft did not grant the required permission');
  const profile = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName',{headers:{authorization:`Bearer ${result.access_token}`},signal:AbortSignal.timeout(15000)});
  const account = await profile.json();
  if (!profile.ok || ![account.mail,account.userPrincipalName].some(value => value?.toLowerCase()===target)) {
    unlinkSync(statePath);
    console.log(JSON.stringify({status:'wrong_mailbox'}));
    process.exit(0);
  }
  writeJson(credentialsPath,{...saved,clientId,mailbox:target,refreshToken:encryptMailToken(result.refresh_token,key),updatedAt:new Date().toISOString()});
  unlinkSync(statePath);
  console.log(JSON.stringify({status:'authorized',mailbox:target}));
} else throw Error('Expected start or poll');
