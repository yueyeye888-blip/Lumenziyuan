import assert from 'node:assert/strict';
import { createCipheriv, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { Miniflare } from 'miniflare';
import { createWallet,fault } from '../commerce/wallet.mjs';
import { createWarehouse } from '../commerce/warehouse.mjs';
import { createWarehousePrices } from '../commerce/warehouse-prices.mjs';

test('warehouse price uses the published daily EUR base, fixed integer units, and rejects unavailable quotes',async()=>{
  const now=Date.parse('2026-11-20T05:00:00Z'); let calls=0;
  const xml="<Cube time='2026-11-19'><Cube currency='USD' rate='1.1250'/><Cube currency='CNY' rate='7.500'/><Cube currency='SGD' rate='1.250'/></Cube>";
  const price=createWarehousePrices({now:()=>now,fetchImpl:async()=>{calls++;return new Response(xml);}});
  assert.equal((await price(105,'USD')).retailUnitRaw,21000);
  assert.equal((await price(null,'USD')).retailUnitRaw,0);
  assert.equal((await price(100,'EUR')).retailUnitRaw,22500);
  assert.equal((await price(100,'CNY')).retailUnitRaw,3000);
  assert.equal((await price(100,'SGD')).retailUnitRaw,18000);
  assert.equal(calls,1);
  await assert.rejects(()=>price(100,'ZZZ'));
  await assert.rejects(()=>createWarehousePrices({now:()=>now,fetchImpl:async()=>new Response(xml.replace('11-19','09-01'))})(100,'CNY'));
});
test('D1 stock allocation, capture recovery, replay after restart, scoped staff access and email', async t=>{
  const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['DB']});
  t.after(()=>mf.dispose());
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  const wallet=createWallet(db),d1=await mf.getD1Database('DB');
  const schema=readFileSync(new URL('../drizzle/0002_sour_jack_flag.sql',import.meta.url),'utf8');
  await d1.batch(schema.split('--> statement-breakpoint').map(statement=>d1.prepare(statement.trim())));
  const key=randomBytes(32);
  async function batch(cost,qty=1) {
    const batchId=randomUUID();
    const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',key,iv);
    const enc=Buffer.concat([cipher.update('private inventory fixture'),cipher.final(),cipher.getAuthTag()]);
    const sql=d1.prepare(`INSERT INTO warehouse_inventory (id,batch_id,supplier,product_name,unit_price,currency,encrypted_value,iv,created_by)
      VALUES(?,?,'Supplier','Product',?,'USD',?,?,'admin')`);
    await d1.batch(Array.from({length:qty},()=>sql.bind(randomUUID(),batchId,cost,enc.toString('base64'),iv.toString('base64'))));return batchId;
  }
  let failCapture=true,sends=0;
  const options={wallet:{...wallet,capture:(u,k)=>{if(failCapture){failCapture=false;throw Error('capture unavailable');}wallet.capture(u,k);}},
    mf,db,config:{origin:'https://test.example',bindings:{SETTINGS_ENCRYPTION_KEY:key.toString('base64')}},
    outlook:{fetch:async req=>{sends++;const body=await req.json();assert.match(body.text,/private inventory fixture/);return Response.json({ok:true,providerId:'test'});}},
    verifyPin:async (u,p)=>{if(p!=='123456')throw fault(400,'PIN');}};
  let api=createWarehouse(options);
  const staff={id:'staff',email:'staff@example.org',name:'Staff'}, guest={...staff,role:'customer'};
  async function post(fields,user=staff) {
    const req=Readable.from([Buffer.from(JSON.stringify(fields))]);req.method='POST';req.headers={origin:options.config.origin,'content-type':'application/json'};
    let status,data;const res={writeHead:n=>{status=n;},end:value=>{data=JSON.parse(value);}};
    await api.route(req,res,new URL('/api/warehouse/claim',options.config.origin),user);return {status,data};
  }
  const b=await batch(150,2);
  const order={requestId:randomUUID(),batchId:b,quantity:2,recipientEmail:'deliver@example.org',quotedUnitRaw:30000,pin:'123456'};
  assert.equal((await post(order,guest)).status,403);
  assert.equal((await post(order)).status,402);
  wallet.credit({userId:'staff',reference:'manual',amountRaw:95000});
  assert.equal((await post({...order,pin:'000000'})).status,400);
  assert.equal((await post({...order,quotedUnitRaw:15000})).status,409);
  assert.equal((await post(order)).status,503);
  assert.equal(wallet.snapshot('staff').heldRaw,60000);
  api=createWarehouse(options);
  await api.recover();
  assert.equal(wallet.balance('staff'),35000);assert.equal(wallet.snapshot('staff').heldRaw,0);
  assert.equal(sends,1);
  assert.equal((await post(order)).data.totalRaw,60000);
  assert.equal((await post({...order,quantity:1})).status,409);
  assert.equal(sends,1);
  assert.equal((await d1.prepare("SELECT count(*) AS n FROM warehouse_inventory WHERE status='claimed' AND email_status='accepted'").first()).n,2);
  const freeBatch=await batch(null,1);
  const free={...order,requestId:randomUUID(),batchId:freeBatch,quantity:1,quotedUnitRaw:0,pin:''};
  const outcomes=await Promise.all([post(free),post({...free,requestId:randomUUID()})]);
  assert.deepEqual(outcomes.map(r=>r.status).sort(),[200,409]);
  assert.equal(wallet.balance('staff'),35000);
});
