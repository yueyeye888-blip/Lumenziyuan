import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { request } from 'node:https';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { openIdentityStore } from '../resource-operations/session-store.mjs';

const source = fileURLToPath(new URL('..',import.meta.url));
function call(port,path,{ cookie,body,method='GET',headers={} } = {}) {
  return new Promise((resolve,reject)=>{
    const req=request({hostname:'127.0.0.1',port,path,method,headers:{...headers,...(cookie?{Cookie:cookie}:{})},
      rejectUnauthorized:false,timeout:4000},res=>{
      const chunks=[];
      res.on('data',chunk=>chunks.push(chunk));
      res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString('utf8')}));
    });
    req.on('error',reject);
    req.on('timeout',()=>req.destroy(Error('Local HTTPS request timed out')));
    req.end(body);
  });
}

test('new server initializes and serves the complete release using only runtime files', { timeout:60_000 },async () => {
  const root=mkdtempSync(join(tmpdir(),'lumen-fresh-'));
  let child;
  let logs='';
  try {
    const ignored = new Set(['node_modules','data','config','logs','private-template-archive','order-queue','backups']);
    cpSync(source,root,{recursive:true,filter:filename=>!ignored.has(filename.slice(source.length).split(/[\\/]+/).filter(Boolean)[0])});
    symlinkSync(join(source,'node_modules'),join(root,'node_modules'),process.platform==='win32'?'junction':'dir');
    const lease=createServer();
    lease.listen(0,'127.0.0.1');
    await once(lease,'listening');
    const {port}=lease.address();
    await new Promise(resolve=>lease.close(resolve));
    const origin='https://127.0.0.1:'+port;
    const password=randomBytes(23).toString('base64url');
    const adminEmail='admin@example.invalid';
    const config=JSON.stringify({origin,port,adminEmail,password});
    const setup=spawnSync(process.execPath,['setup.mjs'],{cwd:root,input:config,encoding:'utf8',timeout:15_000});
    assert.equal(setup.status,0,setup.stderr);
    const cert=spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout','config/tls.key',
      '-out','config/tls.crt','-subj','/CN=localhost','-days','1'],{cwd:root,encoding:'utf8',timeout:10_000});
    assert.equal(cert.status,0,cert.error?.message || cert.stderr);
    const initialized=spawnSync(process.execPath,['initialize.mjs'],{cwd:root,encoding:'utf8',timeout:22_000});
    assert.equal(initialized.status,0,initialized.error?.message || initialized.stderr);
    const reinit=spawnSync(process.execPath,['initialize.mjs'],{cwd:root,encoding:'utf8',timeout:4000});
    assert.notEqual(reinit.status,0);
    const customerEmail='public-buyer@example.invalid', customerPassword=randomBytes(24).toString('base64url');
    let code;
    const configPath=join(root,'config/runtime.json'), runtimeConfig=JSON.parse(readFileSync(configPath,'utf8'));
    const operatorEmail='operator@example.invalid', employeeEmail='staff@example.invalid';
    runtimeConfig.bindings.RESOURCE_ADMIN_EMAILS += ',' + operatorEmail;
    writeFileSync(configPath,JSON.stringify(runtimeConfig));
    const identity=openIdentityStore(root,{config:runtimeConfig,
      outlook:{sendRegistrationCode:async(_email,value)=>{code=value;}}});
    try {
      for (const email of [operatorEmail,employeeEmail]) assert.equal(identity.create({email,name:'Test',password}).status,201);
      await identity.registration.requestCode(customerEmail,'127.0.0.1');
      assert.equal(identity.registration.register({email:customerEmail,code,password:customerPassword}).status,201);
    } finally {identity.close();}
    child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,LUMEN_LISTEN_HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',chunk=>{logs+=String(chunk);});
    child.stderr.on('data',chunk=>{logs+=String(chunk);});
    let health;
    for(let i=0;i<100 && child.exitCode===null;i++) {
      health=await call(port,'/__host/health').catch(()=>null);
      if(health?.status===200) break;
      await delay(100);
    }
    assert.equal(health?.status,200,logs);
    assert.equal(JSON.parse(health.body).ok,true);
    // Chromium sends Origin: null on form POST if the login page suppresses all referrers.
    assert.equal((await call(port,'/__host/login')).headers['referrer-policy'],'same-origin');
    assert.equal((await call(port,'/api/esim/renewals')).status,401);
    assert.equal((await call(port,'/api/address-orders/callback',{method:'POST',body:'{}'})).status,401);
    const login=await call(port,'/__host/login',{method:'POST',
      body:new URLSearchParams({email:adminEmail,password}).toString(),headers:{'Content-Type':'application/x-www-form-urlencoded'}});
    assert.equal(login.status,303);
    const session=login.headers['set-cookie'][0].split(';')[0];
    const get=path=>call(port,path,{cookie:session});
    const home=await get('/');
    assert.equal(home.status,200);
    assert.match(home.body,/\/__host\/dashboard\.css/);
    assert.match((await get('/__host/wallet?embedded=1')).headers['content-security-policy'],/frame-ancestors 'self'/);
    assert.match((await get('/__host/wallet')).headers['content-security-policy'],/frame-ancestors 'none'/);
    assert.match((await get('/__host/shop?embedded=1')).headers['content-security-policy'],/frame-ancestors 'none'/);
    const user=JSON.parse((await get('/api/session')).body).viewer;
    assert.ok(user.isAdmin && user.email===adminEmail);
    const routes = [
      ['/api/groups','groups'],
      ['/api/esim/packages?ids=','items'],
      ['/api/esim/purchases','orders'],
      ['/api/esim/renewals','records'],
      ['/api/mail-deliveries','records'],
      ['/__host/template-archive/catalog','items'],
    ];
    for(const [route,field] of routes) {
      const result=await get(route);
      assert.equal(result.status,200,route);
      assert.deepEqual(JSON.parse(result.body)[field],[],route);
    }
    assert.match((await get('/__host/esim-checkout.js')).body,/lumen:renewal-history/);
    assert.equal((await get('/__host/accounts')).status,200);
    assert.match((await call(port,'/__host/login')).body,/href="\/__host\/register"/);
    assert.match((await call(port,'/__host/register')).body,/发送验证码/);
    const formHeaders={'Content-Type':'application/x-www-form-urlencoded',Origin:origin};
    const unconfigured=await call(port,'/__host/register/code',{method:'POST',headers:formHeaders,body:'email=new%40example.invalid'});
    assert.equal(unconfigured.status,503);
    assert.match(unconfigured.body,/暂时无法发送/);
    assert.equal((await call(port,'/__host/register/code',{method:'POST',headers:{...formHeaders,Origin:'https://another.example'},body:'email=x'})).status,403);
    const customerLogin=await call(port,'/__host/login',{method:'POST',headers:formHeaders,
      body:new URLSearchParams({email:customerEmail,password:customerPassword,returnTo:'/__host/accounts'}).toString()});
    assert.equal(customerLogin.status,303);
    assert.equal(customerLogin.headers.location,'/__host/shop');
    const buyerCookie=customerLogin.headers['set-cookie'][0].split(';')[0];
    const buyer=path=>call(port,path,{cookie:buyerCookie});
    assert.equal((await buyer('/')).headers.location,'/__host/shop');
    assert.equal((await buyer('/?section=wallet&action=recharge')).headers.location,'/__host/shop?section=wallet&action=recharge');
    assert.match((await buyer('/__host/shop?section=wallet')).body,/id="shop-balance"/);
    for(const path of ['/__host/shop','/__host/wallet','/__host/commerce.js','/__host/commerce.css']) assert.equal((await buyer(path)).status,200,path);
    const wallet=JSON.parse((await buyer('/api/commerce/wallet')).body);
    assert.equal(wallet.role,'customer');assert.equal(wallet.availableRaw,0);
    assert.equal(wallet.email,customerEmail);
    const discount = (cookie,email,discountBps) => call(port,'/api/operations/accounts/discount',{
      method:'POST',cookie,headers:{Origin:origin,'Content-Type':'application/json'},
      body:JSON.stringify({email,discountBps})});
    assert.equal((await discount(buyerCookie,customerEmail,8000)).status,403);
    assert.equal((await discount(session,adminEmail,8000)).status,404);
    assert.equal((await discount(session,customerEmail,10001)).status,400);
    assert.equal((await discount(session,customerEmail,8000)).status,200);
    assert.equal(JSON.parse((await buyer('/api/commerce/address/price')).body).priceRaw,80000);
    assert.equal((await buyer('/__host/template-archive/catalog')).status,403);
    assert.equal((await discount(session,customerEmail,null)).status,200);
    assert.equal(JSON.parse((await buyer('/api/commerce/address/price')).body).priceRaw,100000);
    for(const path of ['/api/operations/accounts','/api/groups','/__host/template-archive/catalog','/__host/accounts','/api/warehouse','/api/esim/overview','/api/commerce/admin/deposits'])
      assert.equal((await buyer(path)).status,403,path);
    const adminWallet=JSON.parse((await get('/api/commerce/wallet')).body);
    assert.equal(adminWallet.canManageAccounts,true);
    const operatorLogin=await call(port,'/__host/login',{method:'POST',body:new URLSearchParams({email:operatorEmail,password}).toString()});
    assert.equal(operatorLogin.status,303);
    const opCookie=operatorLogin.headers['set-cookie'][0].split(';')[0];
    const operatorWallet=JSON.parse((await call(port,'/api/commerce/wallet',{cookie:opCookie})).body);
    assert.equal(operatorWallet.role,'admin');
    assert.equal(operatorWallet.canManageAccounts,false);
    assert.equal((await call(port,'/__host/payment-review',{cookie:opCookie})).status,200);
    assert.equal((await call(port,'/__host/accounts',{cookie:opCookie})).status,403);
    const opPost=(path,data)=>call(port,path,{method:'POST',cookie:opCookie,headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(data)});
    assert.equal((await opPost('/api/operations/accounts',{email:'newstaff@example.invalid',name:'New staff',password})).status,403);
    assert.equal((await opPost('/api/commerce/admin/credit',{email:employeeEmail,amount:'50',note:'test',requestId:crypto.randomUUID()})).status,403);
    const employeeLogin=await call(port,'/__host/login',{method:'POST',body:new URLSearchParams({email:employeeEmail,password}).toString()});
    const empCookie=employeeLogin.headers['set-cookie'][0].split(';')[0];
    assert.equal((await call(port,'/api/commerce/deposits',{method:'POST',cookie:empCookie,headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({network:'ETH',amount:10,requestId:crypto.randomUUID()})})).status,403);
    assert.equal(JSON.parse((await call(port,'/api/commerce/wallet',{cookie:empCookie})).body).availableRaw,0);
    const accounts=JSON.parse((await get('/api/operations/accounts')).body);
    assert.equal(accounts.accounts.find(a=>a.email===customerEmail)?.role,'customer');
    assert.equal(JSON.parse((await buyer('/api/commerce/deposits')).body).orders.length,0);
    assert.deepEqual(JSON.parse((await buyer('/api/esim/purchases')).body).orders,[]);

    const write=(path,cookie,method,data)=>{
      const body=JSON.stringify(data);
      return call(port,path,{cookie,method,body,headers:{
        'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),Origin:origin}});
    };
    const staffEmail='employee@example.invalid';
    const created=await write('/api/operations/accounts',session,'POST',{name:'Test employee',email:staffEmail,password});
    assert.equal(created.status,201);
    const staffLogin=await call(port,'/__host/login',{method:'POST',headers:formHeaders,
      body:new URLSearchParams({email:staffEmail,password}).toString()});
    const employeeCookie=staffLogin.headers['set-cookie'][0].split(';')[0];
    // Old clients may still submit a member list. It must not become a buying
    // restriction or disclose email addresses to staff.
    const groupPayload={name:'Employee catalog',memberEmails:['other@example.invalid'],
      products:[{id:'test-product',name:'Test product',supplier:'eSIMAccess'}]};
    const group=await write('/api/groups',session,'POST',groupPayload);
    assert.equal(group.status,200,group.body);
    const groupId=JSON.parse(group.body).id;
    const staffGroups=JSON.parse((await call(port,'/api/groups',{cookie:employeeCookie})).body);
    assert.equal(staffGroups.canManage,false);
    assert.equal(staffGroups.groups[0].products[0].id,'test-product');
    assert.equal(staffGroups.groups[0].canPurchase,true);
    assert.ok(!('memberEmails' in staffGroups.groups[0]));
    assert.equal((await write('/api/groups',employeeCookie,'POST',groupPayload)).status,403);
    assert.equal((await write('/api/groups',session,'DELETE',{ids:[groupId]})).status,200);

  } finally {
    if(child?.exitCode===null) {
      child.kill('SIGTERM');
      await Promise.race([once(child,'exit'),delay(2500)]);
      if(child.exitCode===null) child.kill('SIGKILL');
    }
    rmSync(root,{recursive:true});
  }
});
