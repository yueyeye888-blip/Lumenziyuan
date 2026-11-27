import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const validActor = /^[1-9]\d{0,15}$/;
const validResource = /^[A-Za-z0-9_-]{1,100}$/;
const callbackPattern = /^yorke-esim:([rw]):([a-f0-9]{24})$/;
const prefix = 'yorke-esim:';
const day = 86_400_000;
const hash = value => createHash('sha256').update(value).digest('hex');
const expiryTime = value => Date.parse(value || '');
const dollars = raw => (raw / 10000).toFixed(4).replace(/0{1,2}$/, '');
const clean = (value, limit = 160) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,limit);
const dateLabel = value => Number.isFinite(expiryTime(value))
  ? new Intl.DateTimeFormat('zh-CN',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Singapore'}).format(expiryTime(value))+'（UTC+8）' : null;

class TelegramError extends Error {
  constructor(status) { super('Telegram service unavailable'); this.status = status; }
}

async function telegram(token, method, payload, signal) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(payload),
    signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(20_000)]) : AbortSignal.timeout(10_000),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new TelegramError(Number(data?.error_code) || response.status);
  return data.result;
}

// One durable selection per card's expiry cycle, shared by five-day and one-day messages.
// A notification sent but not bound to its Telegram message ID is never actionable.
function openActions(root) {
  const db = new DatabaseSync(path.join(root,'data','site-esim-telegram-actions.sqlite'));
  db.exec(`PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS esim_telegram_actions (
      token TEXT PRIMARY KEY, cycle TEXT NOT NULL, bot_key TEXT NOT NULL, actor TEXT NOT NULL,
      user_id TEXT NOT NULL, resource_id TEXT NOT NULL, expires_at TEXT NOT NULL, label TEXT NOT NULL,
      package_code TEXT, plan_code TEXT, price_raw INTEGER, plan TEXT, issued_at INTEGER, batch_id TEXT,
      message_id INTEGER, created_at INTEGER NOT NULL, operation TEXT, phase TEXT,
      notice TEXT, notified INTEGER NOT NULL DEFAULT 0, retry_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX IF NOT EXISTS esim_telegram_selected_cycle ON esim_telegram_actions(cycle) WHERE operation IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS esim_telegram_message ON esim_telegram_actions(bot_key,actor,message_id) WHERE message_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS esim_telegram_offsets (
      bot_key TEXT PRIMARY KEY, next INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );`);
  const insert = db.prepare(`INSERT INTO esim_telegram_actions
    (token,cycle,bot_key,actor,user_id,resource_id,expires_at,label,package_code,plan_code,price_raw,plan,issued_at,batch_id,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const get = db.prepare('SELECT * FROM esim_telegram_actions WHERE token=?');
  const byCycle = db.prepare('SELECT * FROM esim_telegram_actions WHERE cycle=? AND operation IS NOT NULL');
  const bind = db.prepare('UPDATE esim_telegram_actions SET message_id=? WHERE token=? AND message_id IS NULL');
  const select = db.prepare("UPDATE esim_telegram_actions SET operation=?,phase='processing' WHERE token=? AND operation IS NULL AND message_id IS NOT NULL");
  const result = db.prepare(`UPDATE esim_telegram_actions SET phase=?,notice=?,notified=CASE WHEN notice IS ? THEN notified ELSE 0 END,retry_at=? WHERE token=?`);
  const pending = db.prepare(`SELECT * FROM esim_telegram_actions WHERE bot_key=? AND actor=? AND user_id=?
    AND operation IS NOT NULL AND retry_at<=? AND (phase!='done' OR notified=0) ORDER BY retry_at LIMIT 20`);
  const notified = db.prepare('UPDATE esim_telegram_actions SET notified=1 WHERE token=? AND notice=?');
  const defer = db.prepare('UPDATE esim_telegram_actions SET retry_at=? WHERE token=?');
  const offset = db.prepare('SELECT next,updated_at FROM esim_telegram_offsets WHERE bot_key=?');
  const saveOffset = db.prepare(`INSERT INTO esim_telegram_offsets VALUES(?,?,?) ON CONFLICT(bot_key) DO UPDATE SET next=excluded.next,updated_at=excluded.updated_at`);
  const clearOffset = db.prepare('DELETE FROM esim_telegram_offsets WHERE bot_key=?');
  return {
    create(fields) {
      const token = randomBytes(12).toString('hex');
      insert.run(token,fields.cycle,fields.botKey,fields.actor,fields.userId,fields.resourceId,
        fields.expiry,fields.label,fields.packageCode ?? null,fields.planCode ?? null,fields.priceRaw ?? null,fields.plan ?? null,
        fields.issuedAt ?? null,fields.batchId ?? null,fields.now);
      // Unselected messages are useless after their expiry and Telegram retains callbacks for only 24 hours.
      // Keep selected rows indefinitely for audit and duplicate-charge protection.
      db.prepare('DELETE FROM esim_telegram_actions WHERE operation IS NULL AND created_at<?').run(fields.now-7*day);
      return token;
    },
    get: token=>get.get(token),
    bind(token,id) { if (bind.run(id,token).changes!==1) throw Error('Telegram reminder message could not be bound'); },
    claim(row,operation) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const selected = byCycle.get(row.cycle);
        const accepted = !selected && select.run(operation,row.token).changes===1;
        db.exec('COMMIT');
        return accepted;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    outcome(token,phase,message,when) { result.run(phase,message,message,when,token); },
    pending: (session,now)=>pending.all(session.botKey,session.actor,session.user.id,now),
    notified: (row)=>notified.run(row.token,row.notice),
    defer: (token,when)=>defer.run(when,token),
    next: (key,now)=>{ const old=offset.get(key); return old&&old.updated_at>now-day ? old.next : undefined; },
    saveOffset: (key,next,now)=>saveOffset.run(key,next,now),
    clearOffset: key=>clearOffset.run(key),
    close: ()=>db.close(),
  };
}

function dedicatedSettings(config,shared) {
  const bindings=config.bindings || {};
  if (bindings.TELEGRAM_DIRECT_ACTIONS!=='1') return null;
  const botToken=String(bindings.TELEGRAM_ESIM_BOT_TOKEN || '').trim();
  const chatId=String(bindings.TELEGRAM_ESIM_CHAT_ID || '').trim();
  const actor=String(bindings.TELEGRAM_DIRECT_ACTOR_ID || '').trim();
  // Never consume updates from the shared notification bot.
  if (!botToken || !validActor.test(actor) || actor!==chatId || !shared?.botToken || botToken===shared.botToken ||
      botToken.split(':')[0]===String(shared.botToken).split(':')[0]) return null;
  return {botToken,chatId,actor,botKey:hash(botToken)};
}

function renewalNotice(row,outcome) {
  const records=outcome?.records;
  const record=Array.isArray(records)&&records.length===1&&records[0].batchId===row.batch_id?records[0]:null;
  const lines=[`Yorke AI · eSIM 续订结果`,row.label,`续订套餐：${row.plan || '原套餐'}`];
  if (!record) return {phase:'pending',message:[...lines,'续订结果暂未确认，系统不会自动再次提交。请核对续订记录。'].join('\n')};
  if (record.status==='succeeded'&&record.receipt) {
    lines.push('续订成功',`金额：US$ ${dollars(record.amountRaw)}`,`供应商回执：${clean(record.receipt)}`);
    const expires=dateLabel(record.expiredTime);
    if (expires) lines.push(`新到期时间：${expires}`);
    return {phase:'done',message:lines.join('\n')};
  }
  if (['rejected','not_sent'].includes(record.status)) return {phase:'done',message:[...lines,'续订未完成',clean(record.error || '供应商拒绝或未发送本次续订。',240)].join('\n')};
  const reason=record.status==='uncertain'?'供应商结果待核对，请勿重复续订。':'续订已接收，等待供应商结果。';
  return {phase:'pending',message:[...lines,reason].join('\n')};
}

export function createTelegramDirectActions({root,config,currentAdmin,loadSharedSettings,purchases,watches,overview,transport=telegram,now=Date.now,autoStart=true}) {
  const requested=config.bindings?.TELEGRAM_DIRECT_ACTIONS==='1';
  const status={requested,ready:false,reason:requested?'waiting_for_dedicated_bot':'disabled'};
  // Do not open any database or consume bot updates unless explicitly opted in.
  if (!requested) return { status, sessionFor:()=>null, prepare:async()=>null, close(){} };
  const store=openActions(root);
  let session, verifiedUntil=0, closed=false, paused=false, timer, inFlight, controller;
  const active=new Map();
  const current=()=>{
    const user=currentAdmin();
    return user?.enabled!==false?user:null;
  };
  const authorized=(row,available)=>available&&current()?.id===row.user_id&&available.user.id===row.user_id;
  async function verify(settings,user) {
    if (session?.botKey===settings.botKey&&session.user.id===user.id&&verifiedUntil>now()) return session;
    const [bot,chat,webhook]=await Promise.all([
      transport(settings.botToken,'getMe',{}),
      transport(settings.botToken,'getChat',{chat_id:settings.chatId}),
      transport(settings.botToken,'getWebhookInfo',{}),
    ]);
    if (chat?.type!=='private'||String(chat.id)!==settings.actor||!bot?.is_bot||!Number.isSafeInteger(bot.id)) throw Error('invalid_private_destination');
    if (webhook?.url) throw Error('dedicated_bot_has_webhook');
    verifiedUntil=now()+5*60_000;
    return session={...settings,user,botId:String(bot.id)};
  }
  function sessionFor(shared,user) {
    const settings=dedicatedSettings(config,shared);
    if (!status.ready||!settings||settings.botKey!==session?.botKey||session?.actor!==settings.actor||session.user.id!==user.id||current()?.id!==user.id) return null;
    return session;
  }
  async function prepare(available,user,row,item,payload) {
    if (closed||!status.ready||session!==available||available.user.id!==user.id||current()?.id!==user.id||row.kind!=='expiry'||
        !validResource.test(row.resource||'')||item?.esimTranNo!==row.resource||!(expiryTime(item.expiredTime)>now())||watches.has(row.resource)) return null;
    const expectedExpiry=new Date(expiryTime(item.expiredTime)).toISOString();
    let preview;
    try {
      const expectedPackageCode=item.packageCode&&!/^TOPUP_/i.test(item.packageCode)?item.packageCode:undefined;
      preview=await purchases.previewReminderRenewal(user,{resourceId:row.resource,expectedExpiry,expectedPackageCode});
      if (preview.expectedExpiry!==expectedExpiry||!validResource.test(preview.expectedPackageCode||'')||
          !validResource.test(preview.planCode||'')||!Number.isSafeInteger(preview.priceRaw)||preview.priceRaw<0||!Number.isSafeInteger(preview.issuedAt)||!preview.plan) preview=null;
    } catch { preview=null; }
    if (closed||!status.ready||session!==available||current()?.id!==user.id||watches.has(row.resource)||expiryTime(expectedExpiry)<=now()) return null;
    const label=`${clean(item.packageName || 'eSIM',100)} · ${item.iccid?'••••'+String(item.iccid).slice(-4):'—'}`;
    const cycle=hash(JSON.stringify([row.resource,expectedExpiry]));
    const token=store.create({cycle,botKey:available.botKey,actor:available.actor,userId:user.id,resourceId:row.resource,expiry:expectedExpiry,
      label,packageCode:preview?.expectedPackageCode,planCode:preview?.planCode,priceRaw:preview?.priceRaw,plan:preview?clean(preview.plan,120):null,
      issuedAt:preview?.issuedAt,batchId:preview?purchases.telegramRenewalId({resourceId:row.resource,expectedExpiry}):null,now:now()});
    const keyboard=payload.reply_markup.inline_keyboard;
    if (preview) {
      payload.text+=`\n续订原套餐：${clean(preview.plan,120)}\n预计费用：US$ ${dollars(preview.priceRaw)}（本次最高扣费金额）`;
      keyboard[0][0]={text:'续订',callback_data:`${prefix}r:${token}`};
    } else keyboard[0][0].text='查看续订报价';
    keyboard[1][0]={text:'不续订并加入观察组',callback_data:`${prefix}w:${token}`};
    return token;
  }
  function bind(token,result) {
    if (!token) return;
    if (!Number.isSafeInteger(result?.message_id)||result.message_id<=0) throw Error('Telegram response omitted reminder message ID');
    store.bind(token,result.message_id);
  }
  async function acknowledge(available,query,text) {
    try { await transport(available.botToken,'answerCallbackQuery',{callback_query_id:query.id,text}); } catch { /* Telegram callback acknowledgements expire; a claimed action remains durable. */ }
  }
  async function notify(available,row) {
    if (closed||!authorized(row,available)||!row.notice||row.notified) return;
    try {
      await transport(available.botToken,'sendMessage',{chat_id:available.chatId,text:row.notice});
      if (!closed) store.notified(row);
      if (row.phase==='done') {
        try { await transport(available.botToken,'editMessageReplyMarkup',{chat_id:available.chatId,message_id:row.message_id,reply_markup:{inline_keyboard:[]}}); } catch { /* The durable selection still prevents a duplicate. */ }
      }
    } catch { /* Keep the result for delivery on a later healthy polling cycle. */ }
  }
  function saveResult(token,phase,message) {
    store.outcome(token,phase,message,now()+30_000);
  }
  async function applyRenewal(available,row,result) {
    if (closed) return;
    const notice=renewalNotice(row,result);
    saveResult(row.token,notice.phase,notice.message);
    await notify(available,store.get(row.token));
  }
  async function recover(available,row,validationError) {
    if (closed||!authorized(row,available)) return;
    try {
      const result=await purchases.telegramRenewalHistory(current(),row.batch_id);
      await applyRenewal(available,row,result);
    } catch (error) {
      if (closed) return;
      if (error?.status===404) {
        // There is no receipt in the authoritative renewal ledger. Do not re-execute on restart.
        const message=validationError?`续订未提交：${clean(validationError,250)}\n请在资源中心重新获取报价。`:'服务中断或续订尚未确认，没有找到续订记录；系统不会自动重试，请在资源中心核对。';
        saveResult(row.token,'done',`Yorke AI · eSIM 续订结果\n${row.label}\n${message}`);
      } else {
        saveResult(row.token,'pending',`Yorke AI · eSIM 续订结果\n${row.label}\n暂时无法核对续订状态，系统不会自动重复提交。`);
      }
      await notify(available,store.get(row.token));
    }
  }
  async function execute(available,row) {
    const user=current();
    if (!authorized(row,available)||closed) return;
    let message;
    if (expiryTime(row.expires_at)<=now()) {
      message='该提醒已过期，请在资源中心重新确认。';
    } else if (row.operation==='watch') {
      try {
        const received=await overview(user);
        const item=received.status===200&&received.data.history?.items?.find(card=>card.esimTranNo===row.resource_id);
        if (closed) return;
        if (current()?.id!==row.user_id||!item||expiryTime(item.expiredTime)!==expiryTime(row.expires_at)) {
          message='资源状态已变化，未加入观察组，请在资源中心核对。';
        } else {
          watches.set([row.resource_id],true);
          message='已加入观察组，停止发送到期提醒。';
        }
      } catch { message='暂时无法核对资源，未加入观察组。'; }
    } else if (watches.has(row.resource_id)) {
      message='此资源已加入观察组，未执行续订。';
    } else {
      try {
        const result=await purchases.renewFromTelegram(user,{resourceId:row.resource_id,expectedExpiry:row.expires_at,
          expectedPackageCode:row.package_code,expectedPlanCode:row.plan_code,issuedAt:row.issued_at,maxPriceRaw:row.price_raw,actionId:row.token},
          () => !closed&&current()?.id===row.user_id&&!watches.has(row.resource_id));
        await applyRenewal(available,row,result);
      } catch (error) {
        const validation=Number.isSafeInteger(error?.status)&&error.status>=400&&error.status<500?error.message:undefined;
        await recover(available,row,validation);
      }
      return;
    }
    if (closed) return;
    saveResult(row.token,'done',`Yorke AI · eSIM ${row.operation==='watch'?'观察组':'续订结果'}\n${row.label}\n${message}`);
    await notify(available,store.get(row.token));
  }
  function track(token,work) {
    if (active.has(token)) return;
    const promise=Promise.resolve().then(work).catch(()=>{}).finally(()=>active.delete(token));
    active.set(token,promise);
  }
  async function callback(available,query) {
    const match=callbackPattern.exec(query.data||'');
    const invalid='此按钮无法操作，请在资源中心核对。';
    if (!match||String(query.from?.id)!==available.actor||query.from?.is_bot||String(query.message?.chat?.id)!==available.actor||
        query.message?.chat?.type!=='private'||String(query.message?.from?.id)!==available.botId||query.message?.from?.is_bot!==true||
        !Number.isSafeInteger(query.message?.date)||query.message.date<=0) {
      await acknowledge(available,query,invalid);
      return;
    }
    const row=store.get(match[2]);
    if (!row||row.bot_key!==available.botKey||row.actor!==available.actor||row.message_id!==query.message.message_id||!authorized(row,available)) {
      await acknowledge(available,query,invalid);
      return;
    }
    const operation=match[1]==='r'?'renew':'watch';
    if (expiryTime(row.expires_at)<=now()||operation==='renew'&&(!row.batch_id||!Number.isSafeInteger(row.price_raw)||!row.package_code||!row.plan_code||!row.issued_at)) {
      await acknowledge(available,query,invalid);
      return;
    }
    if (!store.claim(row,operation)) {
      await acknowledge(available,query,'本次到期提醒已处理，请查看处理结果。');
      return;
    }
    await acknowledge(available,query,operation==='renew'?'已接收续订请求，结果将通过消息通知。':'正在加入观察组。');
    if (!closed) track(row.token,()=>execute(available,store.get(row.token)));
  }
  function reconcile(available) {
    for (const row of store.pending(available,now())) {
      if (active.has(row.token)) continue;
      store.defer(row.token,now()+30_000);
      track(row.token,async()=>{
        if (closed||!authorized(row,available)) return;
        if (row.phase==='done') return notify(available,row);
        if (row.operation==='renew') return recover(available,row);
        // Watching is local and idempotent. Confirm interrupted writes without replaying an old request.
        const message=watches.has(row.resource_id)?'已加入观察组，停止发送到期提醒。':'操作中断，尚未加入观察组，请在资源中心核对。';
        saveResult(row.token,'done',`Yorke AI · eSIM 观察组\n${row.label}\n${message}`);
        return notify(available,store.get(row.token));
      });
    }
  }
  async function runOnce() {
    if (closed||paused||inFlight) return;
    inFlight=(async()=>{
      try {
        const user=current();
        const settings=dedicatedSettings(config,await loadSharedSettings());
        if (closed) return;
        if (!settings||!user) { status.ready=false;status.reason='dedicated_bot_or_owner_not_configured';session=null;return; }
        const available=await verify(settings,user);
        if (closed) return;
        controller=new AbortController();
        const offset=store.next(available.botKey,now());
        // The filter is used only for the configured dedicated bot, never the shared bot.
        const updates=await transport(available.botToken,'getUpdates',{
          timeout:10,limit:20,allowed_updates:['callback_query'],...(offset===undefined?{}:{offset}),
        },controller.signal);
        if (closed) return;
        if (!Array.isArray(updates)) throw Error('invalid_update_response');
        store.clearOffset(available.botKey);
        for (const update of updates) {
          const message=update.message;
          const ownerStart=message?.text==='/start'&&message.chat?.type==='private'&&String(message.chat.id)===available.actor&&
            String(message.from?.id)===available.actor&&!message.from?.is_bot;
          const ownCallback=typeof update.callback_query?.data==='string'&&update.callback_query.data.startsWith(prefix);
          if (!Number.isSafeInteger(update.update_id)||(!ownerStart&&!ownCallback)) {
            // An unknown consumer's updates must remain unacknowledged; pause this listener.
            paused=true; status.ready=false;status.reason='unexpected_bot_updates'; return;
          }
          if (ownCallback) await callback(available,update.callback_query);
          if (closed) return;
          store.saveOffset(available.botKey,update.update_id+1,now());
        }
        status.ready=true;status.reason='ready';
        reconcile(available);
      } catch(error) {
        if (closed) return;
        status.ready=false;
        status.reason=error?.status===409?'telegram_update_consumer_conflict':error?.message==='dedicated_bot_has_webhook'?'dedicated_bot_has_webhook':'dedicated_bot_unavailable';
        if (error?.status===409||error?.message==='dedicated_bot_has_webhook') paused=true;
      } finally { controller=null; }
    })();
    try { await inFlight; } finally { inFlight=null; }
  }
  const schedule=delay=>{
    timer=setTimeout(async()=>{await runOnce();if (!closed&&!paused) schedule(status.ready?500:15_000);},delay);
    timer.unref?.();
  };
  if (autoStart) schedule(1000);
  return {status,sessionFor,prepare,bind,runOnce,async close(){
    if (closed) return;
    closed=true;status.ready=false;clearTimeout(timer);controller?.abort();
    if (inFlight) await inFlight;
    await Promise.allSettled([...active.values()]);
    store.close();
  }};
}
