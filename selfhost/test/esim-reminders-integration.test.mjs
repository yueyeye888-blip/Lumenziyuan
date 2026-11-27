import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { esimReminderCandidates, makeResourceOperations, telegramReminderPayload } from '../resource-operations/resource-operations.mjs';
import { openEsimWatches } from '../resource-operations/esim-watches.mjs';
import { openEsimArchives } from '../resource-operations/esim-archives.mjs';

const day = 86400000;
const mb = 1024 ** 2;
const gb = 1024 ** 3;
const item = {esimTranNo:'line-1', expiredTime:'2026-11-30T00:00:00Z', packageName:'Example'};
const expiry = Date.parse(item.expiredTime);

test('expiry notices retain five-day history, issue one final reminder, and reset on renewal', () => {
  const find = (days, line=item) => esimReminderCandidates([line], expiry-days*day).map(row => row.id);
  assert.deepEqual(find(5.01), []);
  const priorKey = 'expiry:line-1:' + item.expiredTime;
  const finalKey = 'expiry-1d:line-1:' + item.expiredTime;
  for (const days of [5, 4, 1.01]) assert.deepEqual(find(days), [priorKey]);
  for (const days of [1, .95, .01]) assert.deepEqual(find(days), [finalKey]);
  assert.deepEqual(find(0), []);
  assert.deepEqual(find(1, {...item, esimStatus:'REVOKED'}), []);
  assert.deepEqual(find(1, {...item, expiredTime:'2026-12-01T00:00:00Z'}), ['expiry:line-1:2026-12-01T00:00:00Z']);
});

test('expiry messages report measured usage, distinguish missing data, and bind both inline URLs to one card', () => {
  const line = {...item, esimTranNo:'line-abc', iccid:'1234567893979', totalVolume:3*gb, orderUsage:406*mb};
  const make = fields => esimReminderCandidates([{...line,...fields}],expiry-4*day)[0];
  assert.match(make({}).text,/••••3979.*5 天内/);
  assert.match(make({}).text,/406 MB \/ 3 GB（已使用：13\.2%）/);
  assert.match(make({orderUsage:0,usageReported:true}).text,/0 MB \/ 3 GB（已使用：0%）/);
  assert.match(make({orderUsage:0,usageReported:false}).text,/用量：暂未获取 \/ 3 GB/);
  assert.match(make({totalVolume:0,orderUsage:0,usageReported:false}).text,/用量：暂未获取$/);
  assert.match(make({totalVolume:0,dataType:4}).text,/406 MB \/ 不限量$/);
  const payload = telegramReminderPayload('1234','https://example.test',[make({})]);
  const keyboard = payload.reply_markup.inline_keyboard.flat();
  assert.equal(payload.chat_id,'1234');
  assert.match(payload.text,/^Yorke AI · eSIM 资源提醒/);
  assert.deepEqual(keyboard,[
    {text:'续订',url:'https://example.test/?renewEsim=line-abc'},
    {text:'不续订并加入观察组',url:'https://example.test/?watchEsim=line-abc'},
  ]);
});

test('observation excludes expiry but preserves low-data notices and removes neither kind of historical notification key', () => {
  const line = {...item,totalVolume:3*gb,orderUsage:2.9*gb,activateTime:'2026-11-01T00:00:00Z',dataType:1};
  const watched = new Map([[line.esimTranNo,new Date().toISOString()]]);
  for (const days of [5,1,.1]) {
    const records = esimReminderCandidates([line],expiry-days*day,watched);
    assert.deepEqual(records.map(row => row.kind),['low_data']);
    assert.equal(records[0].id,`low-data:line-1:${line.totalVolume}`);
    assert.equal(telegramReminderPayload('1234','https://example.test',records).reply_markup,undefined);
  }
});

test('scheduled reminders send separate expiry messages, batch low data, and deduplicate across subsequent runs', async t => {
  const root = mkdtempSync(join(tmpdir(),'esim-reminders-'));
  mkdirSync(join(root,'data'));
  const watches = openEsimWatches(root);
  const user = {id:'admin-1',role:'employee',email:'admin@example.test'};
  const now = Date.now();
  const line = (esimTranNo,days,orderUsage) => ({...item,esimTranNo,packageName:esimTranNo,
    expiredTime:new Date(now+days*day).toISOString(),totalVolume:3*gb,orderUsage,activateTime:new Date(now-day).toISOString(),dataType:1});
  const first = line('line-first',4,406*mb);
  const final = line('line-final',.5,2.9*gb);
  const observed = line('line-observed',4,2.9*gb);
  const observedDuringSend = line('line-observed-late',4,406*mb);
  watches.set([observed.esimTranNo],true);
  const sent = [];
  const log = new Set();
  const db = {
    prepare(sql) {
      if (sql.startsWith('SELECT encrypted_value')) return {first:async()=>null};
      if (sql.startsWith('SELECT id FROM notification_log')) return {bind:id=>({first:async()=>log.has(id)?{id}:null})};
      if (sql.startsWith('INSERT OR IGNORE INTO notification_log')) return {bind:id=>({id})};
      throw Error(`Unexpected SQL: ${sql}`);
    },
    batch:async rows=>{for(const row of rows) log.add(row.id);},
  };
  let cycles = 0;
  const mf = {
    getD1Database:async()=>db,
    dispatchFetch:async()=>{
      cycles++;
      return Response.json({history:{items:[first,final,observed,observedDuringSend]},viewer:{}});
    },
  };
  t.mock.method(globalThis,'fetch',async (url,init)=>{
    assert.equal(url,'https://api.telegram.org/bottest/sendMessage');
    sent.push(JSON.parse(init.body));
    if (sent.length === 1) watches.set([observedDuringSend.esimTranNo],true);
    return Response.json({ok:true});
  });
  t.mock.timers.enable({apis:['setInterval']});
  const operations = makeResourceOperations({root,config:{origin:'https://example.test',bindings:{RESOURCE_ADMIN_EMAILS:user.email,TELEGRAM_BOT_TOKEN:'test',TELEGRAM_CHAT_ID:'1234'}},mf,identities:{list:()=>[user]}});
  t.after(()=>{operations.close();watches.close();rmSync(root,{recursive:true,force:true});});
  const settle = async predicate => {
    const until = Date.now()+4500;
    while (!predicate() && Date.now()<until) await new Promise(resolve=>setTimeout(resolve,10));
    assert.ok(predicate(),'reminder cycle did not finish');
    await new Promise(resolve=>setImmediate(resolve));
  };
  t.mock.timers.tick(30*60_000);
  await settle(()=>log.size===4);
  assert.equal(sent.length,3);
  assert.equal(sent[0].reply_markup.inline_keyboard[0][0].url,'https://example.test/?renewEsim=line-first');
  assert.equal(sent[1].reply_markup.inline_keyboard[1][0].url,'https://example.test/?watchEsim=line-final');
  assert.equal(sent[2].reply_markup,undefined);
  assert.match(sent[2].text,/line-final.*剩余流量/);
  assert.match(sent[2].text,/line-observed.*剩余流量/);
  assert.ok(![...log].some(key=>key.startsWith('expiry:line-observed:')));
  assert.ok(![...log].some(key=>key.startsWith('expiry:line-observed-late:')));
  t.mock.timers.tick(30*60_000);
  await settle(()=>cycles===2);
  assert.equal(sent.length,3);
  watches.set([observed.esimTranNo],false);
  t.mock.timers.tick(30*60_000);
  await settle(()=>log.size===5);
  assert.equal(sent.length,4);
  assert.equal(sent[3].reply_markup.inline_keyboard[1][0].url,'https://example.test/?watchEsim=line-observed');
});

test('manual current reminders require the owner and ready dedicated bot, persist counts, and never resend the same ID', async t => {
  const root=mkdtempSync(join(tmpdir(),'esim-manual-reminders-'));
  mkdirSync(join(root,'data'));
  const owner={id:'owner',email:'owner@example.test',role:'employee',enabled:true};
  const other={id:'other',email:'other@example.test',role:'employee',enabled:true};
  const origin='https://example.test';
  const config={origin,bindings:{RESOURCE_ADMIN_EMAILS:`${owner.email},${other.email}`,TELEGRAM_BOT_TOKEN:'100:shared',TELEGRAM_CHAT_ID:'55',
    TELEGRAM_DIRECT_ACTIONS:'1',TELEGRAM_ESIM_BOT_TOKEN:'200:dedicated',TELEGRAM_ESIM_CHAT_ID:'55',TELEGRAM_DIRECT_ACTOR_ID:'55'}};
  const now=Date.now();
  const line=(esimTranNo,days=4)=>({...item,esimTranNo,packageName:esimTranNo,packageCode:'PLAN',expiredTime:new Date(now+days*day).toISOString()});
  const items=['sent-one','no-preview','send-failed','send-uncertain','watched','archived'].map(id=>line(id));
  items.push(line('already-expired',-1),line('beyond-window',6));
  const watches=openEsimWatches(root),archives=openEsimArchives(root);
  watches.set(['watched'],true); archives.set(owner.id,['archived'],true);
  watches.close(); archives.close();
  const logged=new Set([`expiry:sent-one:${items[0].expiredTime}`]);
  const db={prepare(sql){
    if (sql.startsWith('SELECT encrypted_value')) return {first:async()=>null};
    if (sql.startsWith('SELECT id FROM notification_log')) return {bind:id=>({first:async()=>logged.has(id)?{id}:null})};
    if (sql.startsWith('INSERT OR IGNORE INTO notification_log')) return {bind:id=>({id})};
    throw Error(`Unexpected SQL: ${sql}`);
  },batch:async rows=>rows.forEach(row=>logged.add(row.id))};
  const sent=[],previews=[];
  const mf={getD1Database:async()=>db,dispatchFetch:async()=>Response.json({history:{items},viewer:{}})};
  const purchases={previewReminderRenewal:async(_user,fields)=>{
    previews.push(fields.resourceId);
    if (fields.resourceId==='no-preview') throw Error('No supported renewal');
    return {...fields,expectedPackageCode:'PLAN',planCode:'TOPUP_PLAN',plan:'Three gigabytes',priceRaw:5000,issuedAt:Date.now()};
  },telegramRenewalId:()=> 'LR-example',renewFromTelegram:()=>assert.fail('manual reminder must not renew or pay')};
  t.mock.method(globalThis,'fetch',async (url,init)=>{
    assert.ok(url.startsWith('https://api.telegram.org/bot200:dedicated/'),'shared bot used for manual request');
    const method=url.split('/').at(-1);
    if (method==='getMe') return Response.json({ok:true,result:{id:200,is_bot:true}});
    if (method==='getChat') return Response.json({ok:true,result:{id:55,type:'private'}});
    if (method==='getWebhookInfo') return Response.json({ok:true,result:{url:''}});
    if (method==='getUpdates') return Response.json({ok:true,result:[]});
    assert.equal(method,'sendMessage');
    const payload=JSON.parse(init.body);
    sent.push(payload);
    assert.match(payload.reply_markup.inline_keyboard[0][0].callback_data,/^yorke-esim:r:[a-f0-9]{24}$/);
    assert.equal(payload.reply_markup.inline_keyboard[0][0].url,undefined);
    assert.match(payload.text,/最高扣费金额/);
    if (payload.text.includes('send-failed')) return Response.json({ok:false,error_code:403},{status:403});
    if (payload.text.includes('send-uncertain')) throw Error('Transport disconnected');
    return Response.json({ok:true,result:{message_id:123}});
  });
  const options={root,config,mf,identities:{list:()=>[owner,other]},readBody:async req=>req.body,purchases};
  let operations=makeResourceOperations(options);
  t.after(async()=>{await operations.close();rmSync(root,{recursive:true,force:true});});
  const requestId='e8603596-e254-4a8a-af9e-46b1aa27f590';
  async function request({user=owner,id=requestId,method='POST',requestOrigin=origin,contentType='application/json',pathname='/api/operations/reminders/send-current'}={}) {
    let result;
    const req={method,headers:{origin:requestOrigin,'content-type':contentType},body:JSON.stringify({requestId:id})};
    const res={writeHead(status){result={status};},end(body){result.body=JSON.parse(body);}};
    assert.equal(await operations.route(req,res,new URL(pathname,origin),user),true);
    return result;
  }
  assert.equal((await request({user:other})).status,403);
  assert.equal((await request({requestOrigin:'https://foreign.test'})).status,403);
  assert.equal((await request({contentType:'text/plain'})).status,403);
  assert.equal((await request({id:'invalid'})).status,400);
  assert.equal((await request()).status,503);
  assert.equal(sent.length,0);
  const ready=async()=> (await request({method:'GET',pathname:'/api/operations/reminders'})).body.directActions.ready;
  const until=Date.now()+4000;
  while (!await ready()&&Date.now()<until) await new Promise(resolve=>setTimeout(resolve,20));
  assert.ok(await ready());
  const started=await request();
  assert.equal(started.status,202);
  assert.equal(started.body.status,'running');
  assert.equal((await request()).status,202);
  assert.equal((await request({id:'fa2b8e82-4620-413a-ad2c-f03e9cb6e064'})).status,409);
  let result;
  const deadline=Date.now()+8000;
  do {
    result=await request();
    if (result.status===202) await new Promise(resolve=>setTimeout(resolve,20));
  } while (result.status===202&&Date.now()<deadline);
  assert.deepEqual(result,{status:200,body:{requestId,status:'completed',matched:4,sent:1,skipped:1,failed:1,uncertain:1,inFlight:false}});
  assert.deepEqual(previews,['sent-one','no-preview','send-failed','send-uncertain']);
  assert.equal(sent.length,3);
  const persisted=new DatabaseSync(join(root,'data','site-esim-telegram-actions.sqlite'),{readOnly:true});
  assert.equal(persisted.prepare('SELECT resource_id FROM esim_telegram_actions WHERE message_id=?').get(123).resource_id,'sent-one');
  persisted.close();
  await operations.close();
  const runs=new DatabaseSync(join(root,'data','site-esim-reminder-runs.sqlite'));
  const interrupted='9dfa0830-cd19-415a-8161-0341d3bfd5a5';
  runs.prepare('INSERT INTO esim_reminder_runs VALUES(?,?,?)').run(interrupted,owner.id,JSON.stringify({requestId:interrupted,status:'running',matched:2,sent:1,skipped:0,failed:0,uncertain:0,inFlight:true}));
  runs.close();
  operations=makeResourceOperations(options);
  assert.deepEqual(await request(),result);
  const recovery=await request({id:interrupted});
  assert.equal(recovery.body.status,'interrupted');
  assert.equal(recovery.body.uncertain,1);
  assert.equal(recovery.body.inFlight,false);
  assert.deepEqual(await request({id:interrupted}),recovery);
  assert.equal(sent.length,3);
});
