import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, symlinkSync, rmSync } from 'node:fs';
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
    assert.equal((await call(port,'/api/esim/renewals')).status,401);
    assert.equal((await call(port,'/api/address-orders/callback',{method:'POST',body:'{}'})).status,401);
    const login=await call(port,'/__host/login',{method:'POST',
      body:new URLSearchParams({email:adminEmail,password}).toString(),headers:{'Content-Type':'application/x-www-form-urlencoded'}});
    assert.equal(login.status,303);
    const session=login.headers['set-cookie'][0].split(';')[0];
    const get=path=>call(port,path,{cookie:session});
    assert.equal((await get('/')).status,200);
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
  } finally {
    if(child?.exitCode===null) {
      child.kill('SIGTERM');
      await Promise.race([once(child,'exit'),delay(2500)]);
      if(child.exitCode===null) child.kill('SIGKILL');
    }
    rmSync(root,{recursive:true});
  }
});
