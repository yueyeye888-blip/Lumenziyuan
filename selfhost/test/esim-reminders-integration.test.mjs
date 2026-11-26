import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { esimReminderCandidates, makeResourceOperations, telegramReminderPayload } from '../resource-operations/resource-operations.mjs';
import { openEsimWatches } from '../resource-operations/esim-watches.mjs';

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
