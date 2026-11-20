import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import http from 'node:http';
import { test } from 'node:test';
import { createEsimPurchases } from '../resource-operations/esim-purchases.mjs';
import { createEsimSupplier } from '../resource-operations/esim-supplier.mjs';

const origin = 'https://test.example';
const admin = { id:'admin', email:'admin@test.example' };
const staff = { id:'staff', email:'staff@test.example' };
const stranger = { id:'other', email:'other@test.example' };
const price = 12_345;
const cart = (id='LH-'+randomUUID(),items=[{id:'SG_Fixed',priceRaw:price,count:3}]) => ({id,items,pin:'864209'});
const packageList = [
  {slug:'SG_Fixed',packageCode:'SG123',name:'Singapore Fixed',price,currencyCode:'USD',dataType:1,duration:7},
  {slug:'SG_Daily',packageCode:'SG124',name:'Singapore Daily',price:16_774,currencyCode:'USD',dataType:2,duration:1},
  {slug:'FR_1',packageCode:'FR123',name:'France 1GB',price:13_000,currencyCode:'USD',dataType:1,duration:7},
];

test('real D1 tables, supplier payloads, order deduplication, balances and QR access',async () => {
  const { Miniflare } = await import('miniflare');
  const mf = new Miniflare({modules:true,script:'export default {fetch(){return new Response("OK")}}',d1Databases:['DB']});
  const db = await mf.getD1Database('DB');
  const bindings = {RESOURCE_ADMIN_EMAILS:admin.email,ESIM_ACCESS_CODE:'fake-access',ESIM_SECRET_KEY:'fake-secret'};
  let profileReady = false;
  let failNextOrder;
  let wallet = 150_000;
  const submitted = [];
  const records = new Map();
  const supplier = createEsimSupplier(bindings,async (url,options) => {
    assert.match(url,/^https:\/\/api\.esimaccess\.com\/api\/v1\/open\//);
    const headers = new Headers(options.headers);
    const input = headers.get('rt-timestamp') + headers.get('rt-requestid') + bindings.ESIM_ACCESS_CODE + options.body;
    assert.equal(headers.get('rt-signature'),createHmac('sha256',bindings.ESIM_SECRET_KEY).update(input).digest('hex'));
    const body=JSON.parse(options.body);
    const success = obj => Response.json({success:true,obj});
    const fail = errorCode => Response.json({success:false,errorCode});
    if (url.endsWith('/package/list')) return success({packageList});
    if (url.endsWith('/balance/query')) return success({balance:wallet});
    if (url.endsWith('/esim/order')) {
      submitted.push(body);
      if (failNextOrder === 'timeout') throw Error('Network aborted');
      if (failNextOrder) return fail(failNextOrder);
      wallet -= body.amount;
      const orderNo = 'ORDER'+submitted.length;
      records.set(orderNo,body);
      return success({orderNo});
    }
    if (url.endsWith('/esim/query')) {
      assert.equal(body.pager.pageSize,50);
      if (!profileReady) return fail('200010');
      const purchase=records.get(body.orderNo);
      const esimList=purchase.packageInfoList.flatMap(plan => Array.from({length:plan.count},(_,index) => ({
        orderNo:body.orderNo,esimTranNo:body.orderNo+'_'+plan.packageCode+'_'+index,
        packageList:[{packageCode:packageList.find(item=>item.slug===plan.packageCode).packageCode}],
      })));
      return success({esimList});
    }
    throw Error('Unexpected supplier request');
  });
  const api = createEsimPurchases({
    config:{origin,bindings},mf,identities:{list:() => [admin,staff,stranger]},supplier,
    readBody:async req => {
      const chunks=[];
      for await (const part of req) chunks.push(part);
      return Buffer.concat(chunks);
    },
  });
  const identities = Object.fromEntries([admin,staff,stranger].map(user => [user.id,user]));
  const server = http.createServer(async (req,res) => {
    if (!await api.route(req,res,new URL(req.url,origin),identities[req.headers['x-test-user']])) res.writeHead(404).end();
  });
  try {
    const migrations = ['0000_empty_killraven','0001_fuzzy_skullbuster','0003_dark_paladin','0004_unique_luckman'];
    for (const file of migrations) {
      const sql=readFileSync(new URL('../drizzle/'+file+'.sql',import.meta.url),'utf8');
      await db.batch(sql.split('--> statement-breakpoint').map(statement=>statement.trim()).filter(Boolean).map(statement=>db.prepare(statement)));
    }
    await db.batch([
      db.prepare("INSERT INTO resource_groups(id,name,created_by) VALUES('test','Purchase group','admin')"),
      db.prepare("INSERT INTO resource_group_items(id,group_id,product_id,product_name,package_code,supplier) VALUES('eligible','test','SG_Fixed','Singapore','SG123','eSIMAccess')"),
      db.prepare("INSERT INTO resource_group_members(id,group_id,user_email,can_purchase,assigned_by) VALUES('member','test','staff@test.example',1,'admin')"),
    ]);
    await api.ready();
    server.listen(0,'127.0.0.1');
    await once(server,'listening');
    async function request(path,user,fields,requestOrigin=origin) {
      const headers={'x-test-user':user.id};
      if (fields) Object.assign(headers,{origin:requestOrigin,'content-type':'application/json'});
      const response=await fetch('http://127.0.0.1:'+server.address().port+path,{headers,method:fields?'POST':'GET',body:fields?JSON.stringify(fields):undefined});
      return {status:response.status,data:await response.json()};
    }
    const orderPath='/api/esim/purchases';
    const quotaPath='/api/esim/purchase-quota';
    const quotePath='/api/esim/purchase-quote';
    assert.equal((await request(quotePath,staff,{ids:['SG_Fixed']})).data.pinConfigured,false);
    for (const user of [admin,staff,stranger]) {
      assert.equal((await request('/api/settings/security',user,{newPin:'864209'})).status,200);
    }
    assert.equal((await request(quotaPath,staff)).status,403);
    assert.equal((await request(quotaPath,admin,{email:staff.email,amount:'20',expectedRaw:0})).status,402);
    assert.equal((await request(quotaPath,admin,{email:staff.email,amount:'10',expectedRaw:0})).data.availableRaw,100_000);
    assert.equal((await request(quotePath,staff,{ids:['SG_Fixed']})).data.availableRaw,100_000);
    assert.equal((await request(quotePath,staff,{ids:['FR_1']})).status,403);
    assert.equal((await request(orderPath,staff,cart(), 'https://other.example')).status,403);
    assert.equal((await request(orderPath,staff,cart(undefined,[{id:'SG_Fixed',priceRaw:price,count:31}]))).status,400);
    assert.equal((await request(orderPath,staff,cart(undefined,[{id:'SG_Fixed',priceRaw:price - 1,count:3}]))).status,409);
    assert.equal((await request(orderPath,staff,cart(undefined,[{id:'SG_Fixed',priceRaw:price,count:9}]))).status,402);
    assert.equal(submitted.length,0);
    const first=cart();
    const [{status,data},retry] = await Promise.all([request(orderPath,staff,first),request(orderPath,staff,first)]);
    assert.equal(status,202);
    assert.equal(data.order.orderNo,'ORDER1');
    assert.equal(retry.data.order.orderNo,'ORDER1');
    assert.equal(submitted.length,1);
    assert.deepEqual(submitted[0],{transactionId:first.id,amount:37_035,packageInfoList:[{packageCode:'SG_Fixed',count:3,price}]});
    assert.equal((await request(orderPath+'?id='+first.id,stranger)).status,404);
    assert.equal((await request(orderPath,stranger)).data.orders.length,0);
    assert.equal((await request(orderPath+'?id='+first.id,admin)).data.order.status,'allocating');
    assert.equal((await api.summary(staff)).availableRaw,62_965);
    assert.equal((await api.summary(admin)).allocatedRaw,62_965);
    profileReady=true;
    const originalNow = Date.now;
    try {
      const future = Date.now()+9000;
      Date.now=()=>future;
      assert.equal((await request(orderPath+'?id='+first.id,staff)).data.order.status,'ready');
    } finally { Date.now=originalNow; }
    const {results:owned} = await db.prepare('SELECT * FROM resource_ownership').all();
    assert.equal(owned.length,3);
    assert.ok(owned.every(row=>row.owner_user_id===staff.id && row.group_id==='test'));
    const today = (await request(quotePath,admin,{ids:['SG_Daily','FR_1']})).data;
    assert.equal(today.lines[0].periodNum,1);
    const combined = cart(undefined,[{id:'SG_Daily',priceRaw:16_774,count:2},{id:'FR_1',priceRaw:13_000,count:1}]);
    const second=await request(orderPath,admin,combined);
    assert.equal(second.status,202);
    assert.deepEqual(submitted.at(-1).packageInfoList,[{packageCode:'SG_Daily',count:2,price:16774,periodNum:1},{packageCode:'FR_1',count:1,price:13000}]);
    failNextOrder='200007';
    const rejection=await request(orderPath,staff,cart());
    assert.equal(rejection.status,409);
    assert.equal(rejection.data.order.status,'rejected');
    assert.equal((await api.summary(staff)).availableRaw,62_965);
    failNextOrder='timeout';
    const uncertain=await request(orderPath,staff,cart());
    assert.equal(uncertain.data.order.status,'uncertain');
    assert.equal((await api.summary(staff)).availableRaw,25_930);
    assert.equal((await request(orderPath,staff,cart())).status,409);
    assert.equal(submitted.length,4);
    assert.equal((await request(quotaPath,admin,{email:staff.email,amount:'1',expectedRaw:62_965})).status,409);
    for (let attempt=0;attempt<5;attempt++) {
      assert.equal((await request('/api/settings/security',stranger,{currentPin:'000000',newPin:'111111'})).status,attempt===4?429:400);
    }
    assert.equal((await request('/api/settings/security',stranger,{currentPin:'864209',newPin:'111111'})).status,429);
    assert.equal((await request(orderPath,admin)).data.orders.length,4);
    const retryFields = {id:uncertain.data.order.id,pin:'864209',retry:true};
    assert.equal((await request(orderPath,staff,retryFields)).status,429);
    assert.equal((await request(orderPath,admin,retryFields)).status,404);
    await db.prepare('UPDATE esim_purchase_orders SET updated_at=? WHERE id=?').bind(new Date(Date.now()-31_000).toISOString(),retryFields.id).run();
    failNextOrder=undefined;
    assert.equal((await request(orderPath,staff,retryFields)).data.order.orderNo,'ORDER5');
    assert.deepEqual(submitted[3],submitted[4]);
    assert.equal((await api.summary(staff)).availableRaw,25_930);
    assert.equal((await request(orderPath,staff,retryFields)).data.order.orderNo,'ORDER5');
    assert.equal(submitted.length,5);
  } finally {
    server.close();
    await mf.dispose();
  }
});
