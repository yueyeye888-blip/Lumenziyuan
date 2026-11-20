import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { SupplierError } from './esim-supplier.mjs';

import { retailPrice, paymentIntent, settlePayment, supplierAvailable } from './esim-commerce.mjs';

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

export function createEsimRenewals({ supplier, dbReady, serialize, isAdmin, availability, wallet, check, readSecurity,
  verifyPaymentPin, validPin, definiteFailures, supplierName, throttle = delay }) {
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

  async function offersFor(db,resourceId,batch) {
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
      if (await blocked(db,resourceId)) return skip('有一笔续费正在处理或待核对，请查看续费记录。');
      const expires = expiry(profile.expiredTime);
      if (!readableStatuses.has(profile.esimStatus) || terminalSmdpStatuses.has(profile.smdpStatus) ||
          (expires && Date.parse(expires) <= Date.now())) return skip('eSIM 已到期或当前状态不支持续费。');
      if (profile.dataType != null && Number(profile.dataType) !== 1) {
        return skip('此按天套餐请在供应商后台确认续费天数与金额。');
      }
      const plans = (await supplier.topupOffers(profile)).filter(compatible);
      const preferred = matchOriginal(original,plans);
      const matched = batch ? [preferred].filter(Boolean)
        : preferred ? [preferred,...plans.filter(plan=>plan.packageCode !== preferred.packageCode)] : plans;
      if (!matched.length) return skip(batch ? '供应商未返回与原套餐匹配的续费方案。' : '供应商未返回可用的续费方案。');
      return { ...card, iccid:profile.iccid, options:matched.map(plan=>({
        code:plan.packageCode, name:plan.name || plan.slug || plan.packageCode, priceRaw:retailPrice(plan.price), costRaw:plan.price,
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
    const balance = supplier.balance().catch(()=>null);
    for(let from=0; from<ids.length; from+=2) {
      cards.push(...await Promise.all(ids.slice(from,from+2).map(id=>offersFor(db,id,batch))));
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
    quotes.set(id,{id, userId:user.id, cards, issuedAt,expiresAt, single:!batch});
    return { id, cards:cards.map(publicCard), availableRaw:Math.min(availability(user),retailPrice(await supplierAvailable(db,raw))),
      pinConfigured:Boolean(await readSecurity(db,user)), expiresAt:new Date(expiresAt).toISOString() };
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

  async function process(db,lines) {
    for (const line of lines) {
      await serialize(async () => {
        const started = await db.prepare("UPDATE esim_renewal_lines SET status='submitting',updated_at=? WHERE id=? AND status='queued'")
          .bind(now(),line.transactionId).run();
        if (started.meta.changes !== 1) return;
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

  async function submit(user,fields) {
    const { id,pin,code } = fields || {};
    check(typeof id === 'string' && validBatch.test(id) && validPin(pin),400,'请填写 6 位支付密码。');
    const db = await dbReady();
    return serialize(async () => {
      const prior = await readBatch(db,id);
      if (prior.length) {
        check(prior[0].user_id === user.id,404,'续费记录未找到。');
        return { id, records:prior.map(present) };
      }
      const approved = quotes.get(id);
      check(approved?.userId===user.id && approved.expiresAt>Date.now(),409,'报价已过期，请重新获取报价。');
      const permitted = approved.cards.filter(card=>card.options.length).map(card=>{
        const option = approved.single ? card.options.find(plan=>plan.code===code) : card.options[0];
        check(option,400,'所选续费方案不在本次报价中。');
        return { ...option, resourceId:card.resourceId, iccid:card.iccid, cardName:card.name, maskedIccid:card.maskedIccid };
      });
      check(permitted.length>0,409,'本次没有可以续费的 eSIM。');
      await authorize(db,user,permitted.map(line=>line.resourceId));
      const since = new Date(approved.issuedAt).toISOString();
      for (const line of permitted) {
        const recent = await db.prepare(`SELECT id FROM esim_renewal_lines WHERE resource_id=? AND status='succeeded'
          AND updated_at>=? LIMIT 1`).bind(line.resourceId,since).first();
        check(!recent && !await blocked(db,line.resourceId),409,'有 eSIM 在报价后已续费或仍待核对，请重新报价并查看续费记录。');
      }
      await verifyPaymentPin(db,user,pin,await readSecurity(db,user));
      const amount = permitted.reduce((sum,line)=>sum+line.priceRaw,0);
      const balance = await supplier.balance();
      const cost = permitted.reduce((sum,line)=>sum+line.costRaw,0);
      check(Number.isSafeInteger(amount) && Number.isSafeInteger(cost),400,'订单金额无效。');
      check(amount<=availability(user),402,'账户余额不足，请先充值。');
      check(cost<=await supplierAvailable(db,balance),409,'供应商暂时无法接受此金额的订单。');
      const staff = isAdmin(user)?0:1;
      const date = now();
      const lines=permitted.map((line,index)=>({...line,transactionId:id+'-'+String(index+1).padStart(2,'0')}));
      await db.batch(lines.flatMap(line=>[db.prepare(`INSERT INTO esim_renewal_lines
        (id,batch_id,user_id,user_email,staff,resource_id,card_label,masked_iccid,plan_name,amount,status,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,'queued',?,?)`).bind(line.transactionId,id,user.id,user.email,staff,
          line.resourceId,line.cardName,line.maskedIccid,line.name,line.priceRaw,date,date),
        paymentIntent(db,line.transactionId,user.id,line.costRaw,line.priceRaw)]));
      try {
        for (const line of lines) if (line.priceRaw) wallet.reserve(user.id,line.transactionId,line.priceRaw);
      } catch (error) {
        await db.prepare("UPDATE esim_renewal_lines SET status='not_sent',error='余额预留失败，未发送续费。' WHERE batch_id=? AND status='queued'").bind(id).run();
        for (const line of lines) await settlePayment(db,wallet,line.transactionId);
        throw error;
      }
      quotes.delete(id);
      void process(db,lines).catch(()=>console.warn('eSIM renewal batch interrupted'));
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

  return { quote,submit,history };
}
