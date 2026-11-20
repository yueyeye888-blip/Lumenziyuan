import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openIdentityStore } from '../resource-operations/session-store.mjs';
import { clientAddress, customerEsimRoute } from '../registration.mjs';
import { encryptMailToken, createOutlookMail } from '../outlook-mail.mjs';
import { verifyPassword } from '../auth.mjs';

function fixture(t) {
  const root=mkdtempSync(path.join(tmpdir(),'lumen-register-'));
  mkdirSync(path.join(root,'data'));
  mkdirSync(path.join(root,'config'));
  writeFileSync(path.join(root,'config','accounts.json'),JSON.stringify([{id:'legacy',name:'Legacy',email:'owner@example.org',enabled:false}]));
  const config={ bindings:{ SETTINGS_ENCRYPTION_KEY:randomBytes(32).toString('base64'),RESOURCE_ADMIN_EMAILS:'owner@example.org,Alias@example.org' } };
  const sent=[];
  let time=Date.now();
  const options={config,now:()=>time,outlook:{sendRegistrationCode:async (email,code)=>{ sent.push({email,code}); }}};
  let identities=openIdentityStore(root,options);
  t.after(()=>{identities.close();rmSync(root,{recursive:true,force:true});});
  return {root,config,sent,options,get store(){return identities;},advance:ms=>{time+=ms;},restart(){identities.close();identities=openIdentityStore(root,options);}};
}
const password='test-password-for-checks';
test('email OTP persists across restart, signs in only a customer and cannot be replayed',async t=>{
  const f=fixture(t), email='jane@example.org';
  const request=await f.store.registration.requestCode(' Jane@Example.org ','192.0.2.3');
  assert.equal(request.status,200);
  assert.equal(f.sent[0].email,email);
  const {code}=f.sent[0];
  assert.match(code,/^\d{6}$/);
  f.restart();
  const sign=f.store.registration.register({email,code,password});
  assert.equal(sign.status,201);
  assert.equal(sign.account.role,'customer');
  assert.ok(verifyPassword(password,f.store.byEmail(email).password));
  const token=f.store.issue(sign.account).split(/[=;]/)[1];
  f.restart();
  assert.equal(f.store.lookup(token).user.role,'customer');
  assert.equal(f.store.registration.register({email,code,password}).status,400);
  assert.equal(f.store.create({email,name:'员工',password}).status,409);
});
test('reserved, disabled and staff emails cannot become public accounts',async t=>{
  const f=fixture(t);
  f.store.create({email:'staff@example.org',name:'员工',password});
  for (const email of ['staff@example.org','Alias@example.org','owner@example.org']) {
    assert.equal((await f.store.registration.requestCode(email,'192.0.2.3')).status,200);
    assert.equal(f.store.registration.register({email,code:'000000',password}).status,400);
  }
  assert.deepEqual(f.sent,[]);
});
test('resend invalidates earlier challenge, limits guessing and fails closed when mail fails',async t=>{
  const f=fixture(t), email='otp@example.org', ip='192.0.2.7';
  await f.store.registration.requestCode(email,ip);
  const first=f.sent[0].code;
  assert.equal((await f.store.registration.requestCode(email,ip)).status,429);
  f.advance(60_001);
  await f.store.registration.requestCode(email,ip);
  const second=f.sent[1].code;
  const bad=second==='000000'?'000001':'000000';
  if(first!==second) assert.equal(f.store.registration.register({email,code:first,password}).status,400);
  for(let i=0;i<5;i++) assert.equal(f.store.registration.register({email,code:bad,password}).status,400);
  assert.equal(f.store.registration.register({email,code:second,password}).status,400);
  f.advance(60_001);
  await f.store.registration.requestCode(email,ip);
  f.advance(600_001);
  assert.equal(f.store.registration.register({email,code:f.sent[2].code,password}).status,400);
  let attempted;
  f.options.outlook.sendRegistrationCode=async (_email,code)=>{attempted=code;throw Error('mail offline');};
  assert.equal((await f.store.registration.requestCode(email,ip)).status,503);
  assert.equal(f.store.registration.register({email,code:attempted,password}).status,400);
});
test('only an explicit customer API surface is allowed and a remote browser cannot choose its rate-limit IP',()=>{
  for (const path of ['/api/settings/telegram','/__host/template-archive/catalog','/api/esim/purchase-quota','/api/esim/overview','/api/groups']) {
    assert.equal(customerEsimRoute('GET',path),false);
    assert.equal(customerEsimRoute('POST',path),false);
  }
  assert.ok(customerEsimRoute('GET','/api/esim/packages'));
  assert.ok(customerEsimRoute('POST','/api/esim/purchases'));
  assert.equal(clientAddress({socket:{remoteAddress:'192.0.2.13'},headers:{'x-forwarded-for':'192.0.2.99'}}),'192.0.2.13');
  assert.equal(clientAddress({socket:{remoteAddress:'127.0.0.1'},headers:{'x-forwarded-for':'192.0.2.99, 192.0.2.13'}}),'192.0.2.13');
});
test('configured Outlook sends an OTP to only the requested recipient and delivers a fixed registration message',async t=>{
  const f=fixture(t);
  writeFileSync(path.join(f.root,'data','outlook-mail-credentials.json'),JSON.stringify({clientId:'test',mailbox:'sender@example.org',
    refreshToken:encryptMailToken('simulated-refresh-token',f.config.bindings.SETTINGS_ENCRYPTION_KEY)}));
  let delivery;
  const mail=createOutlookMail(f.root,f.config,async (url,init)=>{
    if(url.includes('oauth2')) return Response.json({access_token:'test-access',scope:'Mail.Send',expires_in:3600});
    assert.equal(url,'https://graph.microsoft.com/v1.0/me/sendMail');
    delivery=JSON.parse(init.body);
    return new Response(null,{status:202});
  });
  await mail.sendRegistrationCode('user@example.org','012345');
  assert.deepEqual(delivery.message.toRecipients,[{emailAddress:{address:'user@example.org'}}]);
  assert.equal(delivery.saveToSentItems,false);
  assert.match(delivery.message.body.content,/012345/);
});
