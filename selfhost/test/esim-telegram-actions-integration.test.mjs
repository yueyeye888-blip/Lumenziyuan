import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTelegramDirectActions } from '../resource-operations/esim-telegram-actions.mjs';
import { telegramReminderPayload } from '../resource-operations/resource-operations.mjs';

const day=86400000;
const shared={botToken:'100:shared',chatId:'55'};
const dedicated='200:dedicated';
const baseUser={id:'owner',email:'owner@example.test',enabled:true};
const batchId='LR-12345678-1234-4123-8123-123456789abc';

function fixture(t, overrides={}) {
  const root=mkdtempSync(join(tmpdir(),'esim-telegram-actions-'));
  mkdirSync(join(root,'data'));
  const config={origin:'https://example.test',bindings:{TELEGRAM_DIRECT_ACTIONS:'1',TELEGRAM_ESIM_BOT_TOKEN:dedicated,
    TELEGRAM_ESIM_CHAT_ID:'55',TELEGRAM_DIRECT_ACTOR_ID:'55',...overrides}};
  let clock=Date.parse('2030-01-01T12:00:00Z');
  let updates=[], owner=baseUser, previewEnabled=true, profile, settlementStatus='succeeded', failNotice=false, throwSubmit=false;
  const item={esimTranNo:'line-1',packageName:'Three gigabytes',packageCode:'PLAN-1',iccid:'1234567890123456789',expiredTime:new Date(clock+4*day).toISOString()};
  profile=item;
  const calls=[], submitted=[], receipts=new Map(), watches=new Set();
  const result=()=>({id:batchId,records:[{batchId,status:settlementStatus,receipt:settlementStatus==='succeeded'?'receipt-example':null,
    amountRaw:12345,expiredTime:new Date(clock+30*day).toISOString(),error:null}]});
  const options={root,config,currentAdmin:()=>owner,loadSharedSettings:async()=>shared,now:()=>clock,autoStart:false,
    overview:async()=>({status:200,data:{history:{items:[profile]}}}),
    watches:{has:id=>watches.has(id),set(ids,watching){for(const id of ids) watching?watches.add(id):watches.delete(id);}},
    purchases:{
      previewReminderRenewal:async(_user,fields)=>{
        assert.equal(fields.resourceId,item.esimTranNo);
        if (!previewEnabled) throw Error('No supported plan');
        return {...fields,expectedPackageCode:'PLAN-1',planCode:'TOPUP_PLAN-1',plan:'Three gigabytes',priceRaw:12345,issuedAt:clock};
      },
      telegramRenewalId:()=>batchId,
      renewFromTelegram:async (user,fields)=>{
        submitted.push({user,fields});
        receipts.set(batchId,true);
        if (throwSubmit) throw Error('Ambiguous transport');
        return result();
      },
      telegramRenewalHistory:async(_user,id)=>{
        if (!receipts.has(id)) { const e=Error('not found');e.status=404;throw e; }
        return result();
      }
    },
    transport:async(token,method,data)=>{
      assert.equal(token,dedicated,'the shared bot must never be polled');
      calls.push({method,data});
      if (method==='getMe') return {id:200,is_bot:true};
      if (method==='getChat') return {id:55,type:'private'};
      if (method==='getWebhookInfo') return {url:''};
      if (method==='getUpdates') { const batch=updates;updates=[];return batch; }
      if (method==='sendMessage'&&failNotice) { failNotice=false;throw Error('Transient notice failure'); }
      return true;
    },
  };
  let actions=createTelegramDirectActions(options);
  t.after(async()=>{await actions.close();rmSync(root,{recursive:true,force:true});});
  const settle=async()=>{for(let i=0;i<10;i++) await new Promise(resolve=>setImmediate(resolve));};
  let nextUpdate=1;
  async function issue(messageId=10) {
    const session=actions.sessionFor(shared,baseUser);
    assert.ok(session);
    const row={kind:'expiry',resource:item.esimTranNo,text:'Example reminder'};
    const payload=telegramReminderPayload('55',config.origin,[row]);
    const token=await actions.prepare(session,baseUser,row,item,payload);
    assert.ok(token);
    actions.bind(token,{message_id:messageId});
    return payload;
  }
  function query(data,messageId=10,changes={}) {
    const update_id=nextUpdate++;
    return {update_id,callback_query:{id:`cb-${update_id}`,data,from:{id:55,is_bot:false},
      message:{message_id:messageId,date:100,chat:{id:55,type:'private'},from:{id:200,is_bot:true}},...changes}};
  }
  return {
    get actions(){return actions;}, config, item, calls, submitted, watches, options,issue,query,settle,
    async step(batch=[]) {updates=batch;await actions.runOnce?.();await settle();},
    advance:ms=>clock+=ms, state:status=>settlementStatus=status,
    failNotice:()=>failNotice=true, throwSubmit:()=>throwSubmit=true,
    disablePreview:()=>previewEnabled=false, setProfile:value=>profile=value,
    disableOwner:()=>owner={...baseUser,enabled:false},
    async restart(){await actions.close();actions=createTelegramDirectActions(options);},
    notices:()=>calls.filter(call=>call.method==='sendMessage').map(call=>call.data.text),
  };
}

test('one-click callbacks bind one original quote to one provider renewal across both expiry notices',async t=>{
  const f=fixture(t);
  // The new private bot may already have the owner's /start queued before callback filtering is set.
  await f.step([{update_id:900,message:{text:'/start',chat:{id:55,type:'private'},from:{id:55,is_bot:false}}}]);
  assert.equal(f.actions.status.ready,true);
  const first=await f.issue(10),lastDay=await f.issue(11);
  const renew=first.reply_markup.inline_keyboard[0][0];
  const watch=first.reply_markup.inline_keyboard[1][0];
  assert.equal(renew.text,'续订');
  assert.ok(renew.callback_data.length<=64);
  assert.match(first.text,/US\$ 1\.2345/);
  assert.equal(renew.url,undefined);
  assert.ok(f.calls.some(call=>call.method==='getUpdates'&&call.data.allowed_updates.includes('callback_query')));
  await f.step([f.query(renew.callback_data,10,{from:{id:999,is_bot:false}}),
    f.query(renew.callback_data,11), f.query(renew.callback_data,10,{message:{message_id:10,date:100,chat:{id:55,type:'group'},from:{id:200}}})]);
  assert.equal(f.submitted.length,0,'reject unrelated actors and messages');
  await f.step([f.query(renew.callback_data),f.query(renew.callback_data),f.query(watch.callback_data),
    f.query(lastDay.reply_markup.inline_keyboard[0][0].callback_data,11)]);
  assert.equal(f.submitted.length,1);
  const {fields}=f.submitted[0];
  assert.equal(fields.resourceId,f.item.esimTranNo);
  assert.equal(fields.expectedExpiry,f.item.expiredTime);
  assert.equal(fields.expectedPackageCode,'PLAN-1');
  assert.equal(fields.expectedPlanCode,'TOPUP_PLAN-1');
  assert.equal(fields.maxPriceRaw,12345);
  assert.equal(f.watches.size,0);
  assert.equal(f.notices().length,1);
  assert.match(f.notices()[0],/续订成功/);
  assert.match(f.notices()[0],/供应商回执：receipt-example/);
  assert.match(f.notices()[0],/新到期时间：/);
  assert.match(f.notices()[0],/金额：US\$ 1\.2345/);
  await f.restart();
  await f.step([f.query(lastDay.reply_markup.inline_keyboard[0][0].callback_data,11)]);
  assert.equal(f.submitted.length,1,'persisted selection prevents duplicate charge after restart');
});

test('uncertain receipt and failed notification are reconciled without resubmitting',async t=>{
  const f=fixture(t);
  await f.step();
  const message=await f.issue();
  const data=message.reply_markup.inline_keyboard[0][0].callback_data;
  f.state('uncertain');f.throwSubmit();f.failNotice();
  await f.step([f.query(data)]);
  assert.equal(f.submitted.length,1);
  assert.ok(f.notices().some(text=>text.includes('供应商结果待核对')));
  assert.ok(f.notices().every(text=>!text.includes('续订成功')));
  await f.restart();
  f.advance(31_000);
  f.state('succeeded');
  await f.step([f.query(data)]);
  assert.equal(f.submitted.length,1);
  assert.equal(f.notices().filter(text=>text.includes('续订成功')).length,1);
  f.advance(31_000);
  await f.step();
  assert.equal(f.notices().filter(text=>text.includes('续订成功')).length,1);
});

test('unknown price retains web confirmation, observation is local and stale cards cannot be watched',async t=>{
  const f=fixture(t);
  await f.step();
  f.disablePreview();
  const message=await f.issue();
  assert.equal(message.reply_markup.inline_keyboard[0][0].url,'https://example.test/?renewEsim=line-1');
  const watch=message.reply_markup.inline_keyboard[1][0].callback_data;
  assert.ok(watch);
  await f.step([f.query(watch)]);
  assert.equal(f.submitted.length,0);
  assert.ok(f.watches.has(f.item.esimTranNo));
  assert.ok(f.notices().some(text=>text.includes('已加入观察组')));
  await f.step([f.query(watch)]);
  assert.equal(f.notices().length,1);
});

test('watch button verifies original expiry, and disabled administrator cannot authorize it',async t=>{
  const f=fixture(t);
  await f.step();
  const message=await f.issue();
  const watch=message.reply_markup.inline_keyboard[1][0].callback_data;
  f.setProfile({...f.item,expiredTime:new Date(Date.parse(f.item.expiredTime)+day).toISOString()});
  await f.step([f.query(watch)]);
  assert.equal(f.watches.size,0);
  assert.match(f.notices()[0],/资源状态已变化/);
  const other=await f.issue(11);
  f.disableOwner();
  await f.step([f.query(other.reply_markup.inline_keyboard[0][0].callback_data,11)]);
  assert.equal(f.submitted.length,0);
  assert.equal(f.actions.status.ready,false);
});

test('missing opt-in and shared token fail closed without polling; unknown update pauses without acknowledgement',async t=>{
  const disabled=fixture(t,{TELEGRAM_DIRECT_ACTIONS:'0'});
  await disabled.step();
  assert.equal(disabled.calls.length,0);
  assert.equal(disabled.actions.status.ready,false);
  const sharedToken=fixture(t,{TELEGRAM_ESIM_BOT_TOKEN:shared.botToken});
  await sharedToken.step();
  assert.equal(sharedToken.calls.length,0);
  assert.equal(sharedToken.actions.status.ready,false);
  const f=fixture(t);
  await f.step([{update_id:1,message:{text:'foreign',chat:{id:80,type:'private'},from:{id:80}}}]);
  assert.equal(f.actions.status.reason,'unexpected_bot_updates');
  assert.equal(f.actions.status.ready,false);
  const before=f.calls.length;
  await f.step();
  assert.equal(f.calls.length,before);
  assert.ok(f.calls.every(call=>!['setWebhook','deleteWebhook'].includes(call.method)));
});
