import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { testWallet } from './wallet-fixture.mjs';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createEsimPurchases } from '../resource-operations/esim-purchases.mjs';
import { createEsimSupplier } from '../resource-operations/esim-supplier.mjs';

const origin='https://test.example';
const admin={id:'admin',email:'admin@test.example'};
const staff={id:'staff',email:'staff@test.example'};
const outsider={id:'outsider',email:'outsider@test.example'};

test('manual top-up honors ownership, live base match, quota and the supplier receipt',async () => {
  const {Miniflare}=await import('miniflare');
  const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("OK")}}',d1Databases:['DB']});
  const db=await mf.getD1Database('DB');
  const auth={ESIM_ACCESS_CODE:'test-access',ESIM_SECRET_KEY:'test-secret',RESOURCE_ADMIN_EMAILS:admin.email};
  const validThrough=new Date(Date.now()+86400_000).toISOString();
  const cards={
    CARD_A:{esimTranNo:'CARD_A',iccid:'8985123000000000001',esimStatus:'IN_USE',dataType:1,expiredTime:validThrough,
      packageList:[{packageCode:'AA01',slug:'SG_3_30',volume:3221225472,duration:30,packageName:'SG 3GB 30Days'}]},
    CARD_B:{esimTranNo:'CARD_B',iccid:'8985123000000000002',esimStatus:'GOT_RESOURCE',dataType:1,expiredTime:validThrough,
      packageList:[{packageCode:'BB01',slug:'CN_5_30',volume:5368709120,duration:30,packageName:'CN 5GB 30Days'}]},
    CARD_C:{esimTranNo:'CARD_C',iccid:'8985123000000000003',esimStatus:'UNUSED_EXPIRED',dataType:1,expiredTime:validThrough,
      packageList:[{packageCode:'CC01',slug:'MY_5_30',volume:5368709120,duration:30,packageName:'MY 5GB 30Days'}]},
  };
  const toOffer=(resourceId,price,name='Renewal')=>{
    const original=cards[resourceId].packageList[0];
    return {packageCode:'TOPUP_'+original.packageCode,slug:original.slug,volume:original.volume,duration:30,price,
      currencyCode:'USD',durationUnit:'DAY',name,dataType:1,supportTopUpType:1};
  };
  const calls=[];
  let fail;
  let wallet=250_000;
  const supplier=createEsimSupplier(auth,async(url,options)=>{
    const payload=JSON.parse(options.body);
    const headers=new Headers(options.headers);
    const raw=headers.get('rt-timestamp')+headers.get('rt-requestid')+auth.ESIM_ACCESS_CODE+options.body;
    assert.equal(headers.get('rt-signature'),createHmac('sha256',auth.ESIM_SECRET_KEY).update(raw).digest('hex'));
    const ok=obj=>Response.json({success:true,obj});
    if(url.endsWith('/esim/query')) return ok({esimList:[cards[payload.esimTranNo]].filter(Boolean)});
    if(url.endsWith('/balance/query')) return ok({balance:wallet});
    if(url.endsWith('/package/list')) {
      assert.equal(payload.type,'TOPUP');
      assert.equal(cards[payload.esimTranNo].iccid,payload.iccid);
      const offered=toOffer(payload.esimTranNo,payload.esimTranNo==='CARD_A'?15400:22000);
      return ok({packageList:[{...offered,slug:'another',packageCode:'TOPUP_OTHER',duration:7,price:5500},offered]});
    }
    if(url.endsWith('/esim/topup')) {
      calls.push(payload);
      if(fail==='timeout') throw Error('Timeout');
      if(fail==='price') return Response.json({success:false,errorCode:'200006'});
      wallet-=payload.amount;
      return ok({ iccid:cards[payload.esimTranNo].iccid, transactionId:payload.transactionId,
        topUpEsimTranNo:'RECEIPT-'+calls.length, expiredTime:'2099-01-01T00:00:00+0000', totalVolume:6442450944,totalDuration:60 });
    }
    throw Error('Unexpected vendor call');
  });
  const funds=testWallet({staff:150_000});
  const api=createEsimPurchases({wallet:funds,config:{origin,bindings:auth},mf,supplier,identities:{list:()=>[admin,staff,outsider]},readBody:async req=>req.payload});
  async function request(route,user,fields,overrideOrigin=origin) {
    const {pathname}=new URL(route,origin);
    const req={method:fields?'POST':'GET',headers:{origin:overrideOrigin,'content-type':'application/json'},payload:JSON.stringify(fields)};
    let reply;
    const res={writeHead(status){reply={status};},end(value){reply.data=JSON.parse(value);}};
    assert.ok(await api.route(req,res,new URL(route,origin),user),pathname);
    return reply;
  }
  try {
    for(const name of ['0000_empty_killraven','0001_fuzzy_skullbuster','0003_dark_paladin','0004_unique_luckman']) {
      const script=readFileSync(new URL('../drizzle/'+name+'.sql',import.meta.url),'utf8');
      await db.batch(script.split('--> statement-breakpoint').map(statement=>statement.trim()).filter(Boolean).map(statement=>db.prepare(statement)));
    }
    await db.batch(Object.keys(cards).map(id=>db.prepare(`INSERT INTO resource_ownership (resource_id,supplier,owner_user_id,owner_email)
      VALUES (?,'eSIMAccess','staff','staff@test.example')`).bind(id)));
    await api.ready();
    const quotePath='/api/esim/renewal-quote';
    const renewPath='/api/esim/renewals';
    assert.equal((await request('/api/esim/purchase-quota',admin,{email:staff.email,amount:'15',expectedRaw:0})).status,410);
    assert.equal((await request(quotePath,outsider,{ids:['CARD_A']})).status,403);
    const {data:quote}=await request(quotePath,staff,{ids:['CARD_A','CARD_B','CARD_C']});
    assert.deepEqual(quote.cards.map(card=>card.options.map(offer=>offer.code)),[['TOPUP_AA01'],['TOPUP_BB01'],[]]);
    assert.match(quote.cards[2].reason,/到期/);
    assert.ok(quote.cards.every(card=>!card.iccid));
    assert.equal((await request(renewPath,staff,{id:quote.id},'https://other.example')).status,403);
    assert.equal(calls.length,0);
    const start=await Promise.all([request(renewPath,staff,{id:quote.id}),request(renewPath,staff,{id:quote.id})]);
    assert.ok(start.every(reply=>reply.status===202 && reply.data.records.length===2));
    async function settled(id,user=staff) {
      for(let n=0;n<60;n++) {
        const {data:{records}}=await request(renewPath+'?id='+id,user);
        if(records.every(row=>!['queued','submitting'].includes(row.status))) return records;
        await delay(30);
      }
      throw Error('Renewal did not settle');
    }
    const success=await settled(quote.id);
    assert.deepEqual(success.map(row=>row.status),['succeeded','succeeded']);
    assert.deepEqual(success.map(row=>row.receipt),['RECEIPT-1','RECEIPT-2']);
    assert.deepEqual(success.map(row=>row.amountRaw),[30800,44000]);
    assert.equal(success[0].expiredTime,'2099-01-01T00:00:00.000Z');
    assert.deepEqual(calls.map(row=>[row.esimTranNo,row.packageCode,row.amount]),[['CARD_A','TOPUP_AA01',15400],['CARD_B','TOPUP_BB01',22000]]);
    assert.equal((await api.summary(staff)).availableRaw,75200);
    assert.equal((await request(renewPath+'?id='+quote.id,outsider)).status,404);
    assert.equal((await request(renewPath,admin)).data.records.length,2);
    const rejectedQuote=(await request(quotePath,staff,{ids:['CARD_A']})).data;
    fail='price';
    assert.equal((await request(renewPath,staff,{id:rejectedQuote.id,code:'NOT_QUOTED'})).status,400);
    await request(renewPath,staff,{id:rejectedQuote.id,code:'TOPUP_AA01'});
    assert.equal((await settled(rejectedQuote.id))[0].status,'rejected');
    assert.equal((await api.summary(staff)).availableRaw,75200);
    const unknownQuote=(await request(quotePath,staff,{ids:['CARD_A']})).data;
    fail='timeout';
    await request(renewPath,staff,{id:unknownQuote.id,code:'TOPUP_AA01'});
    assert.equal((await settled(unknownQuote.id))[0].status,'uncertain');
    assert.equal((await api.summary(staff)).availableRaw,44400);
    const again=(await request(quotePath,staff,{ids:['CARD_A']})).data;
    assert.match(again.cards[0].reason,/待核对/);
    assert.equal(calls.length,4);
    const {results:ledger}=await db.prepare("SELECT amount FROM quota_transactions WHERE kind='续费' ORDER BY amount").all();
    assert.equal(ledger.length,0);
    assert.equal(funds.count('spent'),2);
    assert.equal(funds.count('held'),1);

    fail=null;
    const directQuote=(await request(quotePath,admin,{ids:['CARD_B']})).data;
    assert.equal(directQuote.paymentSource,'supplier');
    assert.equal(directQuote.supplierBalanceRaw,wallet);
    assert.equal(directQuote.cards[0].options[0].priceRaw,22_000);
    assert.equal((await request(renewPath,admin,{id:directQuote.id,code:'TOPUP_BB01'})).status,202);
    const [directRenewal]=await settled(directQuote.id,admin);
    assert.equal(directRenewal.status,'succeeded');
    assert.equal(directRenewal.amountRaw,22_000);
    assert.equal(calls.at(-1).amount,22_000);
    assert.equal(funds.balance(admin.id),0);
    assert.equal(funds.count('spent'),2);
    assert.equal((await api.supplierBalance(admin)).balanceRaw,wallet);

    staff.discountBps=8000;
    const agentQuote=(await request(quotePath,staff,{ids:['CARD_B']})).data;
    assert.equal(agentQuote.paymentSource,'wallet');
    assert.equal(agentQuote.cards[0].options[0].priceRaw,35_200);
    staff.discountBps=7000;
    assert.equal((await request(renewPath,staff,{id:agentQuote.id,code:'TOPUP_BB01'})).status,409);
    assert.equal(calls.length,5);
  } finally { await mf.dispose(); funds.close(); }
});

test('direct Telegram renewal confirms the original period, displayed plan and cap, and never sends a repeat charge',async t => {
  const {Miniflare}=await import('miniflare');
  const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("OK")}}',d1Databases:['DB']});
  const validThrough=new Date(Date.now()+3*86400_000).toISOString();
  const extendedThrough=new Date(Date.parse(validThrough)+30*86400_000).toISOString();
  const original={packageCode:'ORIGINAL01',slug:'SG_3_30',volume:3221225472,duration:30,durationUnit:'DAY',packageName:'SG 3GB 30Days'};
  const topup={packageCode:'TOPUP_ORIGINAL01',slug:'SG_3_30',volume:3221225472,duration:30,
    price:15400,currencyCode:'USD',durationUnit:'DAY',name:'SG 3GB 30Days renewal',dataType:1};
  const profile=id=>({esimTranNo:id,iccid:'8985123000000000001',esimStatus:'IN_USE',dataType:1,
    expiredTime:validThrough,packageList:[{...original,packageCode:'TOPUP_ORIGINAL01'},original]});
  const cards=new Map(['CARD_A','CARD_B','CARD_C','CARD_D','CARD_E'].map(id=>[id,profile(id)]));
  const calls=[];
  let supplierFunds=250000, offerPrice=topup.price, offeredCode=topup.packageCode;
  const supplier={
    balance:async()=>supplierFunds,
    profile:async id=>cards.has(id)?structuredClone(cards.get(id)):undefined,
    topupOffers:async()=>[{...topup,packageCode:'OTHER',slug:'other',duration:7},
      {...topup,packageCode:offeredCode,price:offerPrice}],
    async topup(line) {
      calls.push(line);
      if(line.resourceId==='CARD_C') throw Error('Synthetic request timeout');
      supplierFunds-=line.priceRaw;
      // CARD_B simulates delayed vendor profile synchronization after a web renewal.
      if(line.resourceId!=='CARD_B') cards.get(line.resourceId).expiredTime=extendedThrough;
      return {receipt:'MOCK_RECEIPT_'+calls.length,expiredTime:extendedThrough,totalVolume:6442450944,totalDuration:60};
    },
  };
  const funds=testWallet({});
  const secondary={id:'secondary',email:'secondary@test.example'};
  const config={origin,bindings:{RESOURCE_ADMIN_EMAILS:admin.email+','+secondary.email}};
  const makeApi=()=>createEsimPurchases({wallet:funds,config,mf,supplier,readBody:async req=>req.payload});
  let api=makeApi();
  const snapshot=(resourceId,extra={})=>({resourceId,expectedExpiry:validThrough,expectedPackageCode:original.packageCode,...extra});
  const click=(quote,extra={})=>({...quote,expectedPlanCode:quote.planCode,maxPriceRaw:quote.priceRaw,actionId:'test-reminder',...extra});
  async function settled(id) {
    for(let n=0;n<60;n++){
      const {records}=await api.telegramRenewalHistory(admin,id);
      if(records.every(row=>!['queued','submitting'].includes(row.status))) return records;
      await delay(30);
    }
    throw Error('Renewal did not settle');
  }
  async function web(path,fields) {
    let result;
    const response={writeHead(status){result={status};},end(body){result.data=JSON.parse(body);}};
    const request={method:'POST',headers:{origin,'content-type':'application/json'},payload:JSON.stringify(fields)};
    assert.ok(await api.route(request,response,new URL(path,origin),admin));
    return result;
  }
  try {
    await api.ready();
    await assert.rejects(api.previewReminderRenewal(staff,snapshot('CARD_A')),error=>error.status===403);
    await assert.rejects(api.previewReminderRenewal(secondary,snapshot('CARD_A')),error=>error.status===403);
    await assert.rejects(api.previewReminderRenewal(admin,snapshot('CARD_A',{expectedPackageCode:'WRONG'})),error=>error.status===409);
    await assert.rejects(api.previewReminderRenewal(admin,snapshot('CARD_A',{expectedExpiry:new Date(Date.parse(validThrough)+1000).toISOString()})),
      error=>error.status===409);
    cards.get('CARD_D').packageList=[{...original,volume:undefined}];
    await assert.rejects(api.previewReminderRenewal(admin,snapshot('CARD_D')),error=>error.status===409);
    cards.get('CARD_E').expiredTime=new Date(Date.now()-1000).toISOString();
    await assert.rejects(api.previewReminderRenewal(admin,snapshot('CARD_E',{expectedExpiry:cards.get('CARD_E').expiredTime})),error=>error.status===409);

    const quote=await api.previewReminderRenewal(admin,snapshot('CARD_A',{expectedPackageCode:undefined}));
    assert.equal(quote.expectedPackageCode,original.packageCode);
    assert.equal(quote.planCode,topup.packageCode);
    assert.equal(quote.priceRaw,15400);
    assert.equal(api.telegramRenewalId(snapshot('CARD_A')),quote.id);
    assert.equal((await web('/api/esim/renewals',{id:quote.id,code:quote.planCode})).status,409);
    await assert.rejects(api.renewFromTelegram(admin,click(quote,{maxPriceRaw:undefined})),error=>error.status===400);
    await assert.rejects(api.renewFromTelegram({...admin,enabled:false},click(quote)),error=>error.status===403);
    await assert.rejects(api.renewFromTelegram(staff,click(quote)),error=>error.status===403);
    offeredCode='TOPUP_DIFFERENT';
    await assert.rejects(api.renewFromTelegram(admin,click(quote)),error=>error.status===409 && /方案已变动/.test(error.message));
    offeredCode=topup.packageCode;
    offerPrice=quote.priceRaw+1;
    await assert.rejects(api.renewFromTelegram(admin,click(quote)),error=>error.status===409 && /价格已高于/.test(error.message));
    assert.equal(calls.length,0);

    offerPrice=15000;
    const submissions=await Promise.all([
      api.renewFromTelegram(admin,click(quote,{actionId:'five-day-notice'})),
      api.renewFromTelegram(admin,click(quote,{actionId:'one-day-notice'})),
    ]);
    assert.ok(submissions.every(result=>result.id===quote.id && result.records.length===1));
    let [result]=await settled(quote.id);
    assert.equal(result.status,'succeeded');
    assert.equal(result.amountRaw,15000);
    assert.equal(result.receipt,'MOCK_RECEIPT_1');
    assert.equal(result.expiredTime,extendedThrough);
    assert.equal(calls.length,1);
    assert.equal(calls[0].resourceId,'CARD_A');
    assert.equal(calls[0].code,topup.packageCode);
    assert.equal(calls[0].transactionId,quote.id+'-01');
    api=makeApi();
    result=(await api.renewFromTelegram(admin,click(quote))).records[0];
    assert.equal(result.status,'succeeded');
    assert.equal(calls.length,1);

    const reminded=await api.previewReminderRenewal(admin,snapshot('CARD_B'));
    const webQuote=(await web('/api/esim/renewal-quote',{ids:['CARD_B']})).data;
    assert.equal((await web('/api/esim/renewals',{id:webQuote.id,code:topup.packageCode})).status,202);
    assert.equal((await settled(webQuote.id))[0].status,'succeeded');
    assert.equal(cards.get('CARD_B').expiredTime,validThrough);
    await assert.rejects(api.renewFromTelegram(admin,click(reminded)),error=>error.status===409);
    assert.equal(calls.length,2);

    const uncertainQuote=await api.previewReminderRenewal(admin,snapshot('CARD_C'));
    await api.renewFromTelegram(admin,click(uncertainQuote));
    assert.equal((await settled(uncertainQuote.id))[0].status,'uncertain');
    api=makeApi();
    assert.equal((await api.renewFromTelegram(admin,click(uncertainQuote))).records[0].status,'uncertain');
    assert.equal((await api.telegramRenewalHistory(admin,uncertainQuote.id)).records[0].status,'uncertain');
    assert.equal(calls.length,3);

    cards.set('CARD_F',profile('CARD_F'));
    const blockedQuote=await api.previewReminderRenewal(admin,snapshot('CARD_F'));
    await assert.rejects(api.renewFromTelegram(admin,click(blockedQuote),()=>false),error=>error.status===409);
    await assert.rejects(api.telegramRenewalHistory(admin,blockedQuote.id),error=>error.status===404);
    let checks=0;
    await api.renewFromTelegram(admin,click(blockedQuote),()=>++checks===1);
    const [blockedResult]=await settled(blockedQuote.id);
    assert.equal(blockedResult.status,'not_sent');
    assert.match(blockedResult.error,/观察状态已变动/);

    // Force the clock past expiry while the accepted request is waiting to send.
    // The direct action must be closed locally even after the payment intent exists.
    cards.set('CARD_G',profile('CARD_G'));
    const expiresWhileQueued=await api.previewReminderRenewal(admin,snapshot('CARD_G'));
    const clock=Date.now.bind(Date);
    let expired=false;
    const mocked=t.mock.method(Date,'now',()=>expired?Date.parse(validThrough)+1:clock());
    try {
      await api.renewFromTelegram(admin,click(expiresWhileQueued),()=>{expired=true;return true;});
      const [expiredResult]=await settled(expiresWhileQueued.id);
      assert.equal(expiredResult.status,'not_sent');
      assert.match(expiredResult.error,/已到期/);
    } finally { mocked.mock.restore(); }
    const db=await api.ready();
    for(const quote of [blockedQuote,expiresWhileQueued]) {
      const {settled,retail_amount}=await db.prepare('SELECT settled,retail_amount FROM esim_commerce_payments WHERE payment_id=?')
        .bind(quote.id+'-01').first();
      assert.equal(settled,1);
      assert.equal(retail_amount,0);
    }
    assert.equal(calls.length,3);
    assert.equal(funds.balance(admin.id),0);
    assert.equal(funds.count('spent'),0);
    assert.equal(funds.count('held'),0);
  } finally { await mf.dispose(); funds.close(); }
});
