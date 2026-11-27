import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { SupplierError } from './esim-supplier.mjs';

import { paymentIntent, settlePayment, supplierAvailable } from './esim-commerce.mjs';

const maxCards = 30;
const quoteLifetime = 3 * 60_000;
const validResource = /^[A-Za-z0-9_-]{1,100}$/;
const validBatch = /^LR-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const readableStatuses = new Set(['GOT_RESOURCE','IN_USE','USED_UP']);
const terminalSmdpStatuses = new Set(['DELETED','REVOKED']);
const trustedFailure = { '200002':'当前 eSIM 状态不允许续费。', '310403':'供应商未找到该 eSIM。' };
const now = () => new Date().toISOString();

function expiry(value) {
  const date = typeof value === 'number'
    ? new Date(value > 1e12 ? value : value * 1000)
    : new Date(typeof value === 'string' ? value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2') : NaN);
  return Number.isFinite(date.getTime()) && date.getTime() > 0 ? date.toISOString() : null;
}
function compatible(plan) {
  return plan && /^[A-Za-z0-9_-]{1,100}$/.test(plan.packageCode || '') &&
    plan.currencyCode === 'USD' && Number.isSafeInteger(plan.price) && plan.price >= 0 &&
    (plan.dataType == null || Number(plan.dataType) === 1);
}
export function originalPlan(profile) {
  const entries = profile.packageList || [];
  return entries.find(plan => plan.packageCode && !String(plan.packageCode).toUpperCase().startsWith('TOPUP_')) || entries[0];
}
export function matchOriginal(original, offers) {
  if (!original) return;
  const candidates = offers.filter(plan => (!original.volume || plan.volume === original.volume) &&
    (!original.duration || plan.duration === original.duration));
  const code = original.packageCode && 'TOPUP_' + original.packageCode;
  return candidates.find(plan => plan.packageCode === code) ||
    candidates.find(plan => original.slug && plan.slug === original.slug);
}

function reminderTime(value) {
  if (typeof value !== 'string' || !value.trim()) return expiry(value);
  const normalized = value.trim().replace(' ', 'T').replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  return expiry(/(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized) ? normalized : normalized + 'Z');
}

// Both the five-day and one-day alerts refer to the same paid renewal period.
// Keep a fixed supplier transaction ID for that period even across a restart.
export function telegramRenewalBatchId(resourceId, expectedExpiry) {
  const period = reminderTime(expectedExpiry);
  if (typeof resourceId !== 'string' || !validResource.test(resourceId) || !period) {
    throw new TypeError('Invalid renewal period');
  }
  const hash = createHash('sha256').update(JSON.stringify(['telegram-esim-renewal',resourceId,period])).digest('hex');
  return 'LR-'+hash.slice(0,8)+'-'+hash.slice(8,12)+'-4'+hash.slice(13,16)+'-8'+hash.slice(17,20)+'-'+hash.slice(20,32);
}

function preciseOriginal(original, offers) {
  if (!original || !Number.isSafeInteger(original.volume) || original.volume <= 0 ||
      !Number.isSafeInteger(original.duration) || original.duration <= 0) return;
  const matched = offers.filter(offer => offer.volume === original.volume &&
    offer.duration === original.duration &&
    (!original.durationUnit || offer.durationUnit === original.durationUnit));
  const exact = matched.filter(offer => offer.packageCode === 'TOPUP_' + original.packageCode);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1 || !original.slug) return;
  const equivalent = matched.filter(offer => offer.slug === original.slug);
  if (equivalent.length === 1) return equivalent[0];
}

const schema = [
  `CREATE TABLE IF NOT EXISTS esim_renewal_lines (
    id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, user_id TEXT NOT NULL, user_email TEXT NOT NULL, staff INTEGER NOT NULL,
    resource_id TEXT NOT NULL, card_label TEXT NOT NULL, masked_iccid TEXT NOT NULL, plan_name TEXT NOT NULL,
    amount INTEGER NOT NULL, status TEXT NOT NULL, receipt TEXT UNIQUE, expires_at TEXT, total_volume INTEGER,
    total_duration INTEGER, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS esim_renewals_batch ON esim_renewal_lines(batch_id)',
  'CREATE INDEX IF NOT EXISTS esim_renewals_resource ON esim_renewal_lines(resource_id,status,created_at)',
  'CREATE INDEX IF NOT EXISTS esim_renewals_owner ON esim_renewal_lines(user_id,created_at)',
  `UPDATE esim_renewal_lines SET status='not_sent',error='服务重启前尚未发送，请重新获取报价。' WHERE status='queued'`,
  "UPDATE esim_renewal_lines SET status='uncertain' WHERE status='submitting'",
];
export const renewalSchema = db => schema.map(sql => db.prepare(sql));

export function createEsimRenewals({ supplier, dbReady, serialize, isAdmin, availability, wallet, check,
  definiteFailures, supplierName, usesSupplier, priceFor, quoteBalance,
  refreshBalance, invalidateBalance, throttle = delay }) {
  const quotes = new Map();

  async function authorize(db,user,ids) {
    if (isAdmin(user)) return;
    const placeholders = ids.map(()=>'?').join(',');
    const {results} = await db.prepare(`SELECT resource_id FROM resource_ownership
      WHERE supplier=? AND owner_user_id=? AND resource_id IN (${placeholders})`).bind(supplierName,user.id,...ids).all();
    check(results.length === ids.length,403,'当前账号无权续费所选 eSIM。');
  }
  const blocked = (db,id) => db.prepare(`SELECT id FROM esim_renewal_lines WHERE resource_id=? AND
    status IN ('queued','submitting','uncertain') LIMIT 1`).bind(id).first();

  async function offersFor(db,resourceId,batch,user,reminder) {
    const card = {resourceId, options:[]};
    const skip = reason => ({...card, reason});
    try {
      const profile = await supplier.profile(resourceId);
      if (!profile || typeof profile.iccid !== 'string' || !/^\d{15,24}$/.test(profile.iccid)) {
        return skip('供应商未返回这张 eSIM 的信息。');
      }
      const original = originalPlan(profile);
      card.name = original?.packageName || original?.slug || 'eSIM';
      card.maskedIccid = '••••' + profile.iccid.slice(-4);
      if (reminder) {
        const liveExpiry = reminderTime(profile.expiredTime);
        if (profile.esimTranNo !== resourceId || !liveExpiry || liveExpiry !== reminder.expectedExpiry ||
            Date.parse(liveExpiry) <= Date.now()) {
          return skip('eSIM 到期时间已变动或已失效，请查看最新资源状态。');
        }
        if (typeof original?.packageCode !== 'string' || !validResource.test(original.packageCode) ||
            /^TOPUP_/i.test(original.packageCode) ||
            (reminder.expectedPackageCode && original.packageCode !== reminder.expectedPackageCode)) {
          return skip('无法确认原套餐，或原套餐已变动，请查看最新资源状态。');
        }
        card.expectedPackageCode = original.packageCode;
      }
      if (await blocked(db,resourceId)) return skip('有一笔续费正在处理或待核对，请查看续费记录。');
      const expires = expiry(profile.expiredTime);
      if (!readableStatuses.has(profile.esimStatus) || terminalSmdpStatuses.has(profile.smdpStatus) ||
          (expires && Date.parse(expires) <= Date.now())) return skip('eSIM 已到期或当前状态不支持续费。');
      if (profile.dataType != null && Number(profile.dataType) !== 1) {
        return skip('此按天套餐请在供应商后台确认续费天数与金额。');
      }
      const plans = (await supplier.topupOffers(profile)).filter(plan => compatible(plan) && priceFor(plan.price,user) !== null);
      const preferred = reminder ? preciseOriginal(original,plans) : matchOriginal(original,plans);
      const matched = batch ? [preferred].filter(Boolean)
        : preferred ? [preferred,...plans.filter(plan=>plan.packageCode !== preferred.packageCode)] : plans;
      if (!matched.length) return skip(batch ? '供应商未返回与原套餐匹配的续费方案。' : '供应商未返回可用的续费方案。');
      return { ...card, iccid:profile.iccid, options:matched.map(plan=>({
        code:plan.packageCode, name:plan.name || plan.slug || plan.packageCode, priceRaw:priceFor(plan.price,user), costRaw:plan.price,
        duration:plan.duration, volume:plan.volume, durationUnit:plan.durationUnit,
      })) };
    } catch {
      return skip('暂时未能查询供应商，请重新获取报价。');
    }
  }

  function publicCard({ iccid, options, ...card }) { return {...card, options:options.map(({costRaw,...offer})=>offer)}; }
  async function quote(user,fields) {
    const ids = fields?.ids;
    check(Array.isArray(ids) && ids.length>=1 && ids.length<=maxCards &&
      ids.every(id=>typeof id === 'string' && validResource.test(id)) && new Set(ids).size===ids.length,
      400,'请选择 1 至 30 张 eSIM 续费。');
    const db = await dbReady();
    await authorize(db,user,ids);
    const issuedAt = Date.now();
    const batch = fields.batch === true || ids.length > 1;
    const cards = [];
    const balance = refreshBalance().catch(()=>null);
    for(let from=0; from<ids.length; from+=2) {
      cards.push(...await Promise.all(ids.slice(from,from+2).map(id=>offersFor(db,id,batch,user))));
      if (from+2<ids.length) await throttle(550);
    }
    const raw = await balance;
    check(raw !== null,503,'暂时无法读取 eSIMAccess 余额，请稍后重试。');
    const id='LR-'+randomUUID();
    const expiresAt = Date.now() + quoteLifetime;
    if (quotes.size>=256) {
      for (const [key,record] of quotes) if (record.expiresAt <= Date.now()) quotes.delete(key);
      if (quotes.size>=256) quotes.delete(quotes.keys().next().value);
    }
    quotes.set(id,{id, userId:user.id, direct:usesSupplier(user), cards, issuedAt,expiresAt, single:!batch});
    return { id, cards:cards.map(publicCard), ...await quoteBalance(db,user,raw),
      expiresAt:new Date(expiresAt).toISOString() };
  }

  const readBatch = async (db,id) => (await db.prepare('SELECT * FROM esim_renewal_lines WHERE batch_id=? ORDER BY id').bind(id).all()).results;
  function present(row) {
    return {
      id:row.id, batchId:row.batch_id, account:row.user_email, card:row.card_label, maskedIccid:row.masked_iccid,
      plan:row.plan_name, amountRaw:row.amount, status:row.status, receipt:row.receipt, expiredTime:row.expires_at,
      totalVolume:row.total_volume, totalDuration:row.total_duration, error:row.error, createdAt:row.created_at,
    };
  }

  async function recordSuccess(db,line,result) {
    await db.prepare(`UPDATE esim_renewal_lines SET status='succeeded',receipt=?,expires_at=?,total_volume=?,
      total_duration=?,updated_at=? WHERE id=? AND status='submitting'`).bind(
        result.receipt,expiry(result.expiredTime),Number.isSafeInteger(result.totalVolume)?result.totalVolume:null,
        Number.isSafeInteger(result.totalDuration)?result.totalDuration:null,now(),line.transactionId).run();
    await settlePayment(db,wallet,line.transactionId);
  }

  async function process(db,lines,reminderApproval) {
    for (const line of lines) {
      await serialize(async () => {
        const started = await db.prepare("UPDATE esim_renewal_lines SET status='submitting',updated_at=? WHERE id=? AND status='queued'")
          .bind(now(),line.transactionId).run();
        if (started.meta.changes !== 1) return;
        // This is the last check before the potentially charged supplier call.
        // The row can be marked not_sent while no external request has been made.
        const reason=reminderApproval && reminderBlockReason(reminderApproval);
        if (reason) {
          await db.prepare("UPDATE esim_renewal_lines SET status='not_sent',error=?,updated_at=? WHERE id=? AND status='submitting'")
            .bind(reason,now(),line.transactionId).run();
          await settlePayment(db,wallet,line.transactionId);
          return;
        }
        let result;
        try {
          result = await supplier.topup({...line,priceRaw:line.costRaw});
        } catch (error) {
          const failure = error instanceof SupplierError ?
            (Object.hasOwn(trustedFailure,error.code) ? trustedFailure[error.code] :
              Object.hasOwn(definiteFailures,error.code) ? definiteFailures[error.code] : null) : null;
          await db.prepare('UPDATE esim_renewal_lines SET status=?,error=?,updated_at=? WHERE id=?')
            .bind(failure?'rejected':'uncertain',failure,now(),line.transactionId).run();
          await settlePayment(db,wallet,line.transactionId);
          return;
        } finally {
          invalidateBalance();
        }
        await recordSuccess(db,line,result);
      }).catch(async () => {
        // A sending attempt can have reached the supplier even when storage failed.
        await db.prepare(`UPDATE esim_renewal_lines SET status=CASE status WHEN 'queued' THEN 'not_sent' ELSE 'uncertain' END,
          updated_at=? WHERE id=? AND status IN ('queued','submitting')`)
          .bind(now(),line.transactionId).run().catch(()=>{});
        await settlePayment(db,wallet,line.transactionId).catch(()=>{});
      });
    }
  }

  async function submit(user,fields,reminderApproval) {
    const { id,code } = fields || {};
    check(typeof id === 'string' && validBatch.test(id),400,'续订编号无效。');
    const db = await dbReady();
    return serialize(async () => {
      const prior = await readBatch(db,id);
      if (prior.length) {
        check(prior[0].user_id === user.id &&
          (!reminderApproval || prior.every(row=>row.resource_id===reminderApproval.resourceId)),404,'续费记录未找到。');
        return { id, records:prior.map(present) };
      }
      // Direct Telegram requests quote within the same mutation queue as web
      // purchases so a concurrent successful renewal cannot invalidate the period.
      const approved = reminderApproval ? {
        ...reminderApproval,userId:user.id,direct:true,single:false,
        cards:[await reminderCard(db,user,reminderApproval)],expiresAt:Date.now()+quoteLifetime,
      } : quotes.get(id);
      const direct = usesSupplier(user);
      check(approved?.userId===user.id && approved.expiresAt>Date.now(),409,'报价已过期，请重新获取报价。');
      const permitted = approved.cards.filter(card=>card.options.length).map(card=>{
        const option = approved.single ? card.options.find(plan=>plan.code===code) : card.options[0];
        check(option,400,'所选续费方案不在本次报价中。');
        return { ...option, resourceId:card.resourceId, iccid:card.iccid, cardName:card.name, maskedIccid:card.maskedIccid };
      });
      check(permitted.length>0,409,'本次没有可以续费的 eSIM。');
      check(approved.direct === direct && permitted.every(line => priceFor(line.costRaw,user) === line.priceRaw),
        409,'账号价格已变动，请重新获取报价。');
      if (reminderApproval) {
        check(permitted.length===1 && permitted[0].code===reminderApproval.expectedPlanCode,409,
          '续费方案已变动，请在网站重新确认最新报价。');
        check(permitted[0].priceRaw<=reminderApproval.maxPriceRaw,409,
          '续费价格已高于提醒中的金额，请在网站重新确认最新报价。');
        check(Date.parse(reminderApproval.expectedExpiry)>Date.now(),409,'该 eSIM 已到期，请查看最新资源状态。');
      }
      await authorize(db,user,permitted.map(line=>line.resourceId));
      const since = new Date(approved.issuedAt).toISOString();
      for (const line of permitted) {
        const recent = await db.prepare(`SELECT id FROM esim_renewal_lines WHERE resource_id=? AND status='succeeded'
          AND updated_at>=? LIMIT 1`).bind(line.resourceId,since).first();
        check(!recent && !await blocked(db,line.resourceId),409,'有 eSIM 在报价后已续费或仍待核对，请重新报价并查看续费记录。');
      }
      const amount = permitted.reduce((sum,line)=>sum+line.priceRaw,0);
      const balance = await refreshBalance();
      const cost = permitted.reduce((sum,line)=>sum+line.costRaw,0);
      check(Number.isSafeInteger(amount) && Number.isSafeInteger(cost),400,'订单金额无效。');
      if (!direct) check(amount<=availability(user),402,'账户余额不足，请先充值。');
      check(cost<=await supplierAvailable(db,balance),409,
        direct ? 'eSIMAccess 供应商账户可用余额不足。' : '供应商暂时无法接受此金额的订单。');
      if (reminderApproval) {
        const reason=reminderBlockReason(reminderApproval);
        check(!reason,409,reason);
      }
      const staff = isAdmin(user)?0:1;
      const date = now();
      const lines=permitted.map((line,index)=>({...line,transactionId:id+'-'+String(index+1).padStart(2,'0')}));
      await db.batch(lines.flatMap(line=>[db.prepare(`INSERT INTO esim_renewal_lines
        (id,batch_id,user_id,user_email,staff,resource_id,card_label,masked_iccid,plan_name,amount,status,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,'queued',?,?)`).bind(line.transactionId,id,user.id,user.email,staff,
          line.resourceId,line.cardName,line.maskedIccid,line.name,line.priceRaw,date,date),
        paymentIntent(db,line.transactionId,user.id,line.costRaw,direct ? 0 : line.priceRaw)]));
      try {
        if (!direct) for (const line of lines) if (line.priceRaw) wallet.reserve(user.id,line.transactionId,line.priceRaw);
      } catch (error) {
        await db.prepare("UPDATE esim_renewal_lines SET status='not_sent',error='余额预留失败，未发送续费。' WHERE batch_id=? AND status='queued'").bind(id).run();
        for (const line of lines) await settlePayment(db,wallet,line.transactionId);
        throw error;
      }
      quotes.delete(id);
      void process(db,lines,reminderApproval).catch(()=>console.warn('eSIM renewal batch interrupted'));
      return { id, records:(await readBatch(db,id)).map(present) };
    });
  }

  async function history(user,query) {
    const db = await dbReady();
    const id = query.get('id');
    if (id) {
      check(validBatch.test(id),404,'续费记录未找到。');
      const rows = await readBatch(db,id);
      check(rows.length && (isAdmin(user) || rows[0].user_id===user.id),404,'续费记录未找到。');
      for (const row of rows) await settlePayment(db,wallet,row.id);
      return { id,records:rows.map(present) };
    }
    const offset = query.get('offset') || '0';
    check(/^\d{1,7}$/.test(offset),400,'页码无效。');
    const { results } = await db.prepare(`SELECT * FROM esim_renewal_lines WHERE (?=1 OR user_id=?)
      ORDER BY created_at DESC,id DESC LIMIT 51 OFFSET ?`).bind(isAdmin(user)?1:0,user.id,Number(offset)).all();
    return { records:results.slice(0,50).map(present),hasMore:results.length>50 };
  }

  function requireReminderAdmin(user) {
    check(user && typeof user.id==='string' && user.id && typeof user.email==='string' &&
      user.enabled!==false && isAdmin(user) && usesSupplier(user),403,'仅启用的主管理员可通过 Telegram 直接续费。');
  }

  function reminderBlockReason(approval) {
    if (Date.parse(approval.expectedExpiry)<=Date.now()) return '该 eSIM 已到期，未发送续费。';
    if (approval.canSubmit) {
      try { if (approval.canSubmit()===true) return null; }
      catch { /* A missing authorization check fails closed. */ }
      return '当前管理员或 eSIM 观察状态已变动，未发送续费。';
    }
    return null;
  }

  function reminderPeriod(fields, requirePackage) {
    const expectedExpiry = reminderTime(fields?.expectedExpiry);
    const {resourceId,expectedPackageCode} = fields || {};
    check(typeof resourceId==='string' && validResource.test(resourceId) && expectedExpiry,400,'续费提醒编号或到期时间无效。');
    check((!requirePackage && expectedPackageCode==null) ||
      (typeof expectedPackageCode==='string' && validResource.test(expectedPackageCode) && !/^TOPUP_/i.test(expectedPackageCode)),
      400,'续费提醒缺少有效的原套餐编号。');
    return {resourceId,expectedExpiry,expectedPackageCode,id:telegramRenewalBatchId(resourceId,expectedExpiry)};
  }

  async function confirmReminderPeriod(db,reminder) {
    const last = await db.prepare(`SELECT expires_at,MAX(expires_at) OVER () AS furthest_expiry
      FROM esim_renewal_lines WHERE resource_id=? AND status='succeeded'
      ORDER BY updated_at DESC,id DESC LIMIT 1`).bind(reminder.resourceId).first();
    if (last) {
      const renewedExpiry = reminderTime(last.expires_at);
      const furthestExpiry = reminderTime(last.furthest_expiry);
      check(renewedExpiry && furthestExpiry && Date.parse(furthestExpiry)<=Date.parse(reminder.expectedExpiry),409,
        '续费记录可能更新了当前有效期，请先核对最新资源状态。');
    }
  }

  async function reminderCard(db,user,reminder) {
    check(Date.parse(reminder.expectedExpiry)>Date.now(),409,'该 eSIM 已到期，请查看最新资源状态。');
    await confirmReminderPeriod(db,reminder);
    const card = await offersFor(db,reminder.resourceId,true,user,reminder);
    check(card.options.length===1,409,card.reason || '未能确认原套餐的续费方案。');
    return card;
  }

  async function previewReminderRenewal(user,fields) {
    requireReminderAdmin(user);
    const reminder = reminderPeriod(fields,false);
    const db = await dbReady();
    const issuedAt = Date.now();
    check(!(await readBatch(db,reminder.id)).length,409,'该到期提醒已有续费记录。');
    const card = await reminderCard(db,user,reminder);
    const option = card.options[0];
    return {
      id:reminder.id,resourceId:reminder.resourceId,expectedExpiry:reminder.expectedExpiry,
      expectedPackageCode:card.expectedPackageCode,plan:option.name,planCode:option.code,
      priceRaw:option.priceRaw,duration:option.duration,volume:option.volume,durationUnit:option.durationUnit,issuedAt,
    };
  }

  async function renewFromTelegram(user,fields,canSubmit) {
    requireReminderAdmin(user);
    const reminder = reminderPeriod(fields,true);
    const {expectedPlanCode,maxPriceRaw,issuedAt} = fields;
    check(typeof expectedPlanCode==='string' && validResource.test(expectedPlanCode),400,'续费提醒缺少已确认的续费方案。');
    check(Number.isSafeInteger(maxPriceRaw) && maxPriceRaw>=0 &&
      Number.isSafeInteger(issuedAt) && issuedAt>0 && issuedAt<=Date.now() &&
      issuedAt<Date.parse(reminder.expectedExpiry),400,'续费提醒缺少有效的确认金额或报价时间。');
    check(canSubmit===undefined || typeof canSubmit==='function',400,'续费授权状态无效。');
    return submit(user,{id:reminder.id},{...reminder,expectedPlanCode,maxPriceRaw,issuedAt,canSubmit});
  }

  function telegramRenewalHistory(user,id) {
    requireReminderAdmin(user);
    return history(user,new URLSearchParams({id}));
  }

  return {
    quote,submit,history,previewReminderRenewal,renewFromTelegram,telegramRenewalHistory,
    telegramRenewalId:fields=>reminderPeriod(fields,false).id,
  };
}
