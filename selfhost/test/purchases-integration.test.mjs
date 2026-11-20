import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import http from 'node:http';
import { testWallet } from './wallet-fixture.mjs';
import { test } from 'node:test';
import { createEsimPurchases } from '../resource-operations/esim-purchases.mjs';
import { createEsimSupplier } from '../resource-operations/esim-supplier.mjs';
import { makeResourceOperations } from '../resource-operations/resource-operations.mjs';
import { openEsimArchives } from '../resource-operations/esim-archives.mjs';
import JSZip from '../resource-operations/jszip.cjs';

const origin = 'https://test.example';
const admin = { id:'admin', email:'admin@test.example' };
const staff = { id:'staff', email:'staff@test.example' };
const stranger = { id:'other', email:'other@test.example' };
const cost = 12_345;
const price = 2 * cost;
const cart = (id='LH-'+randomUUID(),items=[{id:'SG_Fixed',priceRaw:price,count:3}]) => ({id,items,pin:'864209'});
const packageList = [
  {slug:'SG_Fixed',packageCode:'SG123',name:'Singapore Fixed',price:cost,currencyCode:'USD',dataType:1,duration:7},
  {slug:'SG_Daily',packageCode:'SG124',name:'Singapore Daily',price:16_774,currencyCode:'USD',dataType:2,duration:1},
  {slug:'FR_1',packageCode:'FR123',name:'France 1GB',price:13_000,currencyCode:'USD',dataType:1,duration:7},
];

test('real D1 tables, supplier payloads, order deduplication, balances and QR access',async () => {
  const { Miniflare } = await import('miniflare');
  const mf = new Miniflare({modules:true,script:'export default {fetch(){return new Response("OK")}}',d1Databases:['DB']});
  const db = await mf.getD1Database('DB');
  const bindings = {RESOURCE_ADMIN_EMAILS:admin.email,ESIM_ACCESS_CODE:'fake-access',ESIM_SECRET_KEY:'fake-secret'};
  let profileReady = false;
  let extraProfile = false;
  let failNextOrder;
  let wallet = 150_000;
  const submitted = [];
  const queriedOrders = [];
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
      assert.ok(body.orderNo);
      queriedOrders.push(body.orderNo);
      if (!profileReady) return fail('200010');
      const purchase=records.get(body.orderNo);
      const esimList=purchase.packageInfoList.flatMap(plan => Array.from({length:plan.count},(_,index) => ({
        orderNo:body.orderNo,esimTranNo:body.orderNo+'_'+plan.packageCode+'_'+index,
        packageList:[{packageCode:packageList.find(item=>item.slug===plan.packageCode).packageCode}],
      })));
      if (extraProfile) esimList.push({orderNo:body.orderNo,esimTranNo:'OTHER_UNASSIGNED_CARD'});
      return success({esimList});
    }
    throw Error('Unexpected supplier request');
  });
  const customer = {...stranger,id:'public',email:'customer@test.example',role:'customer'};
  const funds = testWallet({staff:200_000});
  async function readBody(req) {
    const chunks=[];
    for await (const part of req) chunks.push(part);
    return Buffer.concat(chunks);
  }
  const api = createEsimPurchases({wallet:funds,
    config:{origin,bindings},mf,identities:{list:() => [admin,staff,stranger]},supplier,readBody,
  });
  const mailRoot = mkdtempSync(path.join(tmpdir(),'lumen-esim-email-'));
  mkdirSync(path.join(mailRoot,'data'));
  const sentWorkbooks = [];
  const operations = makeResourceOperations({
    root:mailRoot,config:{origin,bindings},mf,wallet:funds,purchases:api,readBody,
    outlook:{sendEsimWorkbook:async mail => {
      sentWorkbooks.push(mail);
      return {status:'accepted'};
    }},
  });
  const otherBuyer = { id:'second-customer',email:'second-customer@test.example',role:'customer' };
  const identities = Object.fromEntries([admin,staff,stranger,customer,otherBuyer].map(user => [user.id,user]));
  const server = http.createServer(async (req,res) => {
    const user = identities[req.headers['x-test-user']];
    const url = new URL(req.url,origin);
    try {
      if (!await api.route(req,res,url,user) && !await operations.route(req,res,url,user)) res.writeHead(404).end();
    } catch (error) {
      res.writeHead(500).end(JSON.stringify({error:error.message}));
    }
  });
  try {
    const migrations = ['0000_empty_killraven','0001_fuzzy_skullbuster','0002_sour_jack_flag','0003_dark_paladin','0004_unique_luckman'];
    for (const file of migrations) {
      const sql=readFileSync(new URL('../drizzle/'+file+'.sql',import.meta.url),'utf8');
      await db.batch(sql.split('--> statement-breakpoint').map(statement=>statement.trim()).filter(Boolean).map(statement=>db.prepare(statement)));
    }
    await db.batch([
      db.prepare("INSERT INTO resource_groups(id,name,created_by) VALUES('test','Purchase group','admin')"),
      db.prepare("INSERT INTO resource_group_items(id,group_id,product_id,product_name,package_code,supplier) VALUES('eligible','test','SG_Fixed','Singapore','SG123','eSIMAccess')"),
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
    assert.equal((await request(quotaPath,admin,{email:staff.email,amount:'20',expectedRaw:0})).status,410);
    assert.equal((await request(quotePath,staff,{ids:['SG_Fixed']})).data.availableRaw,200_000);
    const publicQuote = await request(quotePath,customer,{ids:['FR_1']});
    assert.equal(publicQuote.data.lines[0].priceRaw,26_000);
    assert.equal(publicQuote.data.availableRaw,0);
    assert.equal((await request(quotePath,staff,{ids:['FR_1']})).data.lines[0].priceRaw,26_000);
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
    assert.deepEqual(submitted[0],{transactionId:first.id,amount:37_035,packageInfoList:[{packageCode:'SG_Fixed',count:3,price:cost}]});
    assert.equal((await request(orderPath+'?id='+first.id,stranger)).status,404);
    assert.equal((await request(orderPath,stranger)).data.orders.length,0);
    assert.equal((await request(orderPath+'?id='+first.id,admin)).data.order.status,'allocating');
    assert.equal((await api.summary(staff)).availableRaw,125_930);
    assert.deepEqual(await api.supplierBalance(admin),{balanceRaw:wallet,availableRaw:wallet});
    assert.equal(await api.supplierBalance(customer),null);
    assert.equal((await api.summary(admin)).availableRaw,wallet);
    profileReady=true;
    const originalNow = Date.now;
    try {
      const future = Date.now()+9000;
      Date.now=()=>future;
      assert.equal((await request(orderPath+'?id='+first.id,staff)).data.order.status,'ready');
    } finally { Date.now=originalNow; }
    const {results:owned} = await db.prepare('SELECT * FROM resource_ownership').all();
    assert.equal(owned.length,3);
    assert.equal((await request('/api/esim/purchase-cards?id='+first.id,customer)).status,404);
    assert.equal((await request('/api/esim/purchase-cards?id='+first.id,staff)).data.cards.length,3);
    assert.equal(funds.count('held'),0);
    assert.equal(funds.count('spent'),1);
    assert.ok(owned.every(row=>row.owner_user_id===staff.id && row.group_id==='test'));
    const today = (await request(quotePath,admin,{ids:['SG_Daily','FR_1']})).data;
    assert.equal(today.paymentSource,'supplier');
    assert.equal(today.supplierBalanceRaw,wallet);
    assert.equal(today.lines[0].periodNum,1);
    assert.equal(today.lines[0].priceRaw,16_774);
    const combined = cart(undefined,[{id:'SG_Daily',priceRaw:16_774,count:2},{id:'FR_1',priceRaw:13_000,count:1}]);
    const second=await request(orderPath,admin,combined);
    assert.equal(second.status,202);
    assert.equal(second.data.order.amountRaw,46_548);
    assert.equal(funds.balance(admin.id),0);
    const directPayment=await db.prepare('SELECT product_cost,retail_amount,settled FROM esim_commerce_payments WHERE payment_id=?').bind(combined.id).first();
    assert.deepEqual(directPayment,{product_cost:46_548,retail_amount:0,settled:1});
    assert.deepEqual(submitted.at(-1).packageInfoList,[{packageCode:'SG_Daily',count:2,price:16774,periodNum:1},{packageCode:'FR_1',count:1,price:13000}]);
    failNextOrder='200007';
    const rejection=await request(orderPath,staff,cart());
    assert.equal(rejection.status,409);
    assert.equal(rejection.data.order.status,'rejected');
    assert.equal((await api.summary(staff)).availableRaw,125_930);
    failNextOrder='timeout';
    const uncertain=await request(orderPath,staff,cart());
    assert.equal(uncertain.data.order.status,'uncertain');
    assert.equal((await api.summary(staff)).availableRaw,51_860);
    assert.equal((await request(orderPath,staff,cart())).status,409);
    assert.equal(submitted.length,4);
    assert.equal((await request(quotaPath,admin,{email:staff.email,amount:'1',expectedRaw:125_930})).status,410);
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
    assert.equal((await api.summary(staff)).availableRaw,51_860);
    assert.equal((await request(orderPath,staff,retryFields)).data.order.orderNo,'ORDER5');
    assert.equal(submitted.length,5);
    assert.equal(funds.count('held'),0);
    assert.equal(funds.count('spent'),2);
    // A live transaction interrupted before this release retains the original supplier
    // amount. Its legacy debit becomes part of the eventual quota migration.
    const legacyId='LH-'+randomUUID(), oldTime=new Date(Date.now()-40_000).toISOString();
    const legacyLines=[{id:'SG_Fixed',code:'SG_Fixed',packageCode:'SG123',name:'Singapore Fixed',priceRaw:cost,count:1}];
    await db.prepare(`INSERT INTO esim_purchase_orders(id,user_id,user_email,user_name,status,staff,amount,lines,created_at,updated_at)
      VALUES(?,?,?,?,'uncertain',1,?,?,?,?)`).bind(legacyId,staff.id,staff.email,'Test employee',cost,JSON.stringify(legacyLines),oldTime,oldTime).run();
    assert.equal((await request(orderPath,staff,{id:legacyId,pin:'864209',retry:true})).data.order.status,'allocating');
    assert.equal(submitted.at(-1).amount,cost);
    assert.equal((await api.summary(staff)).availableRaw,51_860);
    assert.equal((await db.prepare('SELECT amount FROM quota_transactions WHERE id=?').bind(legacyId).first()).amount,-cost);

    await request('/api/settings/security',customer,{newPin:'864209'});
    funds.credit({userId:customer.id,amountRaw:80_000,reference:'deposit:public',note:'Confirmed deposit'});
    const selfService = await request(orderPath,customer,cart(undefined,[{id:'FR_1',priceRaw:26_000,count:1}]));
    assert.equal(selfService.status,202);
    assert.equal(selfService.data.order.amountRaw,26_000);
    assert.equal(submitted.at(-1).amount,13_000);
    assert.equal(funds.balance(customer.id),54_000);
    assert.equal((await request(orderPath+'?id='+selfService.data.order.id,staff)).status,404);
    const cardCheck=await request('/api/esim/purchase-cards?id='+selfService.data.order.id,customer);
    assert.equal(cardCheck.data.cards.length,1);
    const queriedBefore=queriedOrders.length;
    assert.deepEqual(await api.customerProfiles({...customer,id:'brand-new'}),{items:[],partial:false,available:true});
    assert.equal(queriedOrders.length,queriedBefore);
    const resourceId = cardCheck.data.cards[0].resourceId;
    await db.prepare(`INSERT INTO resource_status_overrides
      (id,supplier,resource_id,status,note,marked_by_user_id,marked_by_email) VALUES
      (?,'eSIMAccess',?,'temporary_unavailable','Tester marked this card',?,?)`)
      .bind('eSIMAccess:'+resourceId,resourceId,customer.id,customer.email).run();
    extraProfile = true;
    const own=await api.customerProfiles(customer);
    extraProfile = false;
    assert.equal(own.items[0].override.note,'Tester marked this card');
    assert.deepEqual(own.items.map(({profile})=>profile.esimTranNo),[cardCheck.data.cards[0].resourceId]);
    assert.deepEqual(queriedOrders.slice(queriedBefore),[selfService.data.order.orderNo]);
    assert.equal(own.partial,false);
    const archivePath = '/api/esim/archive';
    const overviewPath = '/api/esim/overview';
    const archiveSelection = {ids:[resourceId],archived:true};
    assert.equal((await request(archivePath,customer)).status,405);
    assert.equal((await request(archivePath,customer,archiveSelection,'https://other.example')).status,403);
    assert.equal((await request(archivePath,customer,{...archiveSelection,archived:'true'})).status,400);
    assert.equal((await request(archivePath,customer,{...archiveSelection,ids:[resourceId,'invalid/id']})).status,400);
    assert.equal((await request(archivePath,otherBuyer,archiveSelection)).status,403);
    assert.equal((await request(archivePath,customer,{...archiveSelection,ids:[resourceId,owned[0].resource_id]})).status,403);
    assert.equal((await request(overviewPath,customer)).data.history.items[0].archivedAt,null);
    const archived = await request(archivePath,customer,archiveSelection);
    assert.equal(archived.status,200,JSON.stringify(archived.data));
    assert.deepEqual(archived.data.ids,[resourceId]);
    assert.match(archived.data.archivedAt,/^\d{4}-\d{2}-\d{2}T.*Z$/);
    const visibleArchive = (await request(overviewPath,customer)).data.history;
    assert.equal(visibleArchive.total,1);
    assert.equal(visibleArchive.items[0].archivedAt,archived.data.archivedAt);
    assert.equal(visibleArchive.items[0].availabilityStatus,'temporary_unavailable');
    assert.deepEqual((await request(overviewPath,otherBuyer)).data.history.items,[]);
    const reopenedArchives = openEsimArchives(mailRoot);
    try {
      assert.equal(reopenedArchives.list(customer.id).get(resourceId),archived.data.archivedAt);
      assert.equal(reopenedArchives.list(otherBuyer.id).size,0);
    } finally {
      reopenedArchives.close();
    }
    const emailPath = '/api/esim/email';
    const delivery = {ids:[resourceId],recipient:'buyer-inbox@example.invalid',requestId:randomUUID()};
    const notOwned = await request(emailPath,customer,{...delivery,ids:[resourceId,owned[0].resource_id]});
    assert.equal(notOwned.status,403);
    assert.equal(sentWorkbooks.length,0);
    const mailed = await request(emailPath,customer,delivery);
    assert.equal(mailed.status,202,JSON.stringify(mailed.data));
    assert.equal((await request(emailPath,customer,delivery)).status,202);
    assert.equal(sentWorkbooks.length,1);
    assert.equal(sentWorkbooks[0].to,delivery.recipient);
    assert.equal(sentWorkbooks[0].count,1);
    const workbook = await JSZip.loadAsync(sentWorkbooks[0].buffer);
    const sheet = await workbook.file('xl/worksheets/sheet1.xml').async('string');
    assert.ok(sheet.includes(resourceId) && !sheet.includes(owned[0].resource_id));
    assert.equal((await request(emailPath,otherBuyer,delivery)).status,403);
    assert.equal(sentWorkbooks.length,1);
    assert.deepEqual(await request(archivePath,customer,{ids:[resourceId],archived:false}),
      {status:200,data:{ids:[resourceId],archivedAt:null}});
    assert.equal((await request(overviewPath,customer)).data.history.items[0].archivedAt,null);
    // Simulate a process exit after the balance hold and before a vendor request;
    // an accepted order with an interrupted local settlement must be replayed once.
    const beforeRestart=funds.balance(customer.id);
    const interrupted='LH-'+randomUUID(), accepted='LH-'+randomUUID();
    for (const [id,state] of [[interrupted,'preparing'],[accepted,'allocating']]) {
      funds.reserve(customer.id,id,1000);
      await db.batch([
        db.prepare(`INSERT INTO esim_purchase_orders(id,user_id,user_email,user_name,status,staff,amount,lines,created_at,updated_at)
          VALUES(?,?,?,?,?,1,1000,'[]',?,?)`).bind(id,customer.id,customer.email,'Test customer',state,oldTime,oldTime),
        db.prepare('INSERT INTO esim_commerce_payments(payment_id,user_id,product_cost,retail_amount) VALUES(?,?,500,1000)').bind(id,customer.id),
      ]);
    }
    const restarted=createEsimPurchases({config:{origin,bindings},wallet:funds,mf,supplier});
    await restarted.ready();
    await restarted.settle();
    assert.equal(funds.balance(customer.id),beforeRestart-1000);
    assert.equal((await db.prepare('SELECT status FROM esim_purchase_orders WHERE id=?').bind(interrupted).first()).status,'rejected');

    // Changing an account's percentage affects new quotes and pays the same vendor cost.
    customer.discountBps=8000;
    wallet=40_000;
    const agentQuote=(await request(quotePath,customer,{ids:['FR_1']})).data;
    assert.equal(agentQuote.paymentSource,'wallet');
    assert.equal(agentQuote.supplierBalanceRaw,undefined);
    assert.equal(agentQuote.lines[0].priceRaw,20_800);
    assert.equal((await request(orderPath,customer,cart(undefined,[{id:'FR_1',priceRaw:26_000,count:1}]))).status,409);
    const agentOrder=await request(orderPath,customer,cart(undefined,[{id:'FR_1',priceRaw:20_800,count:1}]));
    assert.equal(agentOrder.status,202);
    assert.equal(funds.balance(customer.id),beforeRestart-1000-20_800);
    assert.equal(submitted.at(-1).amount,13_000);

    wallet=cost-1;
    const count=submitted.length;
    const insufficient=await request(orderPath,admin,cart(undefined,[{id:'SG_Fixed',priceRaw:cost,count:1}]));
    assert.equal(insufficient.status,409);
    assert.match(insufficient.data.error,/供应商账户可用余额不足/);
    assert.equal(submitted.length,count);
  } finally {
    server.close();
    operations.close();
    rmSync(mailRoot,{recursive:true,force:true});
    await mf.dispose(); funds.close();
  }
});
