import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createEsimPurchases } from '../resource-operations/esim-purchases.mjs';
import { createEsimSupplier } from '../resource-operations/esim-supplier.mjs';

const origin='https://test.example';
const admin={id:'admin',email:'admin@test.example'};
const staff={id:'staff',email:'staff@test.example'};
const outsider={id:'outsider',email:'outsider@test.example'};

test('manual top-up honors ownership, live base match, PIN, quota and the supplier receipt',async () => {
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
  const api=createEsimPurchases({config:{origin,bindings:auth},mf,supplier,identities:{list:()=>[admin,staff,outsider]},readBody:async req=>req.payload});
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
    assert.equal((await request('/api/settings/security',staff,{newPin:'654321'})).status,200);
    assert.equal((await request('/api/esim/purchase-quota',admin,{email:staff.email,amount:'15',expectedRaw:0})).status,200);
    assert.equal((await request(quotePath,outsider,{ids:['CARD_A']})).status,403);
    const {data:quote}=await request(quotePath,staff,{ids:['CARD_A','CARD_B','CARD_C']});
    assert.deepEqual(quote.cards.map(card=>card.options.map(offer=>offer.code)),[['TOPUP_AA01'],['TOPUP_BB01'],[]]);
    assert.match(quote.cards[2].reason,/到期/);
    assert.ok(quote.cards.every(card=>!card.iccid));
    assert.equal((await request(renewPath,staff,{id:quote.id,pin:'000000'})).status,400);
    assert.equal((await request(renewPath,staff,{id:quote.id,pin:'654321'},'https://other.example')).status,403);
    assert.equal(calls.length,0);
    const start=await Promise.all([request(renewPath,staff,{id:quote.id,pin:'654321'}),request(renewPath,staff,{id:quote.id,pin:'654321'})]);
    assert.ok(start.every(reply=>reply.status===202 && reply.data.records.length===2));
    async function settled(id) {
      for(let n=0;n<60;n++) {
        const {data:{records}}=await request(renewPath+'?id='+id,staff);
        if(records.every(row=>!['queued','submitting'].includes(row.status))) return records;
        await delay(30);
      }
      throw Error('Renewal did not settle');
    }
    const success=await settled(quote.id);
    assert.deepEqual(success.map(row=>row.status),['succeeded','succeeded']);
    assert.deepEqual(success.map(row=>row.receipt),['RECEIPT-1','RECEIPT-2']);
    assert.equal(success[0].expiredTime,'2099-01-01T00:00:00.000Z');
    assert.deepEqual(calls.map(row=>[row.esimTranNo,row.packageCode,row.amount]),[['CARD_A','TOPUP_AA01',15400],['CARD_B','TOPUP_BB01',22000]]);
    assert.equal((await api.summary(staff)).availableRaw,112600);
    assert.equal((await request(renewPath+'?id='+quote.id,outsider)).status,404);
    assert.equal((await request(renewPath,admin)).data.records.length,2);
    const rejectedQuote=(await request(quotePath,staff,{ids:['CARD_A']})).data;
    fail='price';
    assert.equal((await request(renewPath,staff,{id:rejectedQuote.id,pin:'654321',code:'NOT_QUOTED'})).status,400);
    await request(renewPath,staff,{id:rejectedQuote.id,pin:'654321',code:'TOPUP_AA01'});
    assert.equal((await settled(rejectedQuote.id))[0].status,'rejected');
    assert.equal((await api.summary(staff)).availableRaw,112600);
    const unknownQuote=(await request(quotePath,staff,{ids:['CARD_A']})).data;
    fail='timeout';
    await request(renewPath,staff,{id:unknownQuote.id,pin:'654321',code:'TOPUP_AA01'});
    assert.equal((await settled(unknownQuote.id))[0].status,'uncertain');
    assert.equal((await api.summary(staff)).availableRaw,97200);
    const again=(await request(quotePath,staff,{ids:['CARD_A']})).data;
    assert.match(again.cards[0].reason,/待核对/);
    assert.equal(calls.length,4);
    const {results:ledger}=await db.prepare("SELECT amount FROM quota_transactions WHERE kind='续费' ORDER BY amount").all();
    assert.deepEqual(ledger.map(row=>row.amount),[-22000,-15400]);
  } finally { await mf.dispose(); }
});
