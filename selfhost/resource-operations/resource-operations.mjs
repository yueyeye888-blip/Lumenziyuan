import { withLocale } from '../commerce/locale-html.mjs';
import { canManageAccounts, viewerFor } from './account-access.mjs';
import { esimPrice, validDiscount } from '../commerce/pricing.mjs';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { trustedHeaders } from './auth.mjs';
import { makeEsimWorkbook } from './esim-export.mjs';
import { openEsimMailLog, normalizeRecipient } from './esim-mail-log.mjs';
import { openEsimArchives } from './esim-archives.mjs';
import { openEsimWatches } from './esim-watches.mjs';
import { createTelegramDirectActions } from './esim-telegram-actions.mjs';
import { maxWorkbookBytes } from '../outlook-mail.mjs';

const isEsimId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
const archiveBatchLimit = 10_000;
const day = 86_400_000;
const pollInterval = 30 * 60_000;
const manualReminderId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const lastDate = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Singapore' });
const validTime = value => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const input = value.trim().replace(' ', 'T').replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const timestamp = Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/i.test(input) ? input : input + 'Z');
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
};
function decorate(item) {
  return {
    ...item, expiredTime: validTime(item.expiredTime), activateTime: validTime(item.activateTime), createTime: validTime(item.createTime),
    expiryKind: item.activateTime || !['GOT_RESOURCE', 'UNUSED_EXPIRED'].includes(item.esimStatus) ? 'plan' : 'activation',
  };
}
function customerHistoryItem({profile,override}) {
  const plan = profile.packageList?.[0];
  return decorate({
    availabilityStatus: override.status || 'normal',
    availabilityNote: override.note || null,
    availabilityRecheckAt: override.recheck_at || null,
    orderNo: profile.orderNo,
    transactionId: profile.transactionId || null,
    esimTranNo: profile.esimTranNo,
    iccid: profile.iccid || null,
    imsi: profile.imsi || null,
    msisdn: profile.msisdn || null,
    activationCode: profile.ac || null,
    qrCodeUrl: typeof profile.qrCodeUrl === 'string' && /^https:\/\//i.test(profile.qrCodeUrl) ? profile.qrCodeUrl : null,
    shortUrl: typeof profile.shortUrl === 'string' && /^https:\/\//i.test(profile.shortUrl) ? profile.shortUrl : null,
    eid: profile.eid || null,
    smsStatus: profile.smsStatus ?? null,
    activeType: profile.activeType ?? null,
    dataType: profile.dataType ?? null,
    activateTime: profile.activateTime || null,
    esimStatus: profile.esimStatus,
    smdpStatus: profile.smdpStatus,
    totalVolume: profile.totalVolume || 0,
    orderUsage: profile.orderUsage || 0,
    usageReported: Number.isFinite(profile.orderUsage) && profile.orderUsage >= 0,
    expiredTime: profile.expiredTime || null,
    totalDuration: profile.totalDuration || plan?.duration || null,
    durationUnit: profile.durationUnit || 'DAY',
    pin: profile.pin || null,
    puk: profile.puk || null,
    apn: profile.apn || null,
    packageName: plan?.packageName || 'eSIM 套餐',
    packageCode: plan?.packageCode || null,
    locationCode: plan?.locationCode || null,
    createTime: plan?.createTime || null,
  });
}

const statusForMail = {
  delivered: { code:'delivered', tone:'success', label:'已确认交付', detail:'该地址订单已收到交付完成回执。' },
  failed: { code:'failed', tone:'error', label:'订单处理失败', detail:'该订单没有邮件交付回执。' },
  waiting: { code:'pending', tone:'warning', label:'等待交付', detail:'订单尚无交付完成回执。' },
};

function formatVolume(bytes) {
  return bytes >= 1024 ** 3
    ? `${Number((bytes / 1024 ** 3).toFixed(2))} GB`
    : `${Number((bytes / 1024 ** 2).toFixed(1))} MB`;
}

function reminderUsage(item) {
  const used = item.orderUsage;
  const total = item.totalVolume;
  const usedKnown = item.usageReported !== false && Number.isFinite(used) && used >= 0;
  const totalKnown = Number.isFinite(total) && total > 0;
  if (!totalKnown) {
    if (usedKnown && item.dataType === 4) return `用量：${formatVolume(used)} / 不限量`;
    return usedKnown ? `用量：${formatVolume(used)} / 总量暂未获取` : '用量：暂未获取';
  }
  if (!usedKnown) return `用量：暂未获取 / ${formatVolume(total)}`;
  const percent = Number(((used / total) * 100).toFixed(1));
  return `用量：${formatVolume(used)} / ${formatVolume(total)}（已使用：${percent}%）`;
}

export function esimReminderCandidates(items, now, watched = new Map()) {
  const result = [];
  for (const item of items) {
    if (['USED_EXPIRED','UNUSED_EXPIRED','CANCEL','REVOKED'].includes(item.esimStatus) || ['DELETED','REVOKED'].includes(item.smdpStatus)) continue;
    const expiry = Date.parse(item.expiredTime);
    const masked = item.iccid ? `••••${item.iccid.slice(-4)}` : '—';
    const label = `${String(item.packageName).slice(0,100)} · ${masked}`;
    if (!watched.has(item.esimTranNo) && expiry > now && expiry <= now + 5 * day) {
      const lastDay = expiry - now <= day;
      // Keep the original five-day key so existing notices stay deduplicated after upgrade.
      const prefix = lastDay ? 'expiry-1d' : 'expiry';
      result.push({id:`${prefix}:${item.esimTranNo}:${item.expiredTime}`,resource:item.esimTranNo,kind:'expiry',
        text:`${label} · ${item.expiryKind === 'activation' ? '最晚激活' : '套餐到期'} ${lastDate.format(expiry)}（UTC+8，${lastDay ? '1 天内' : '5 天内'}）\n${reminderUsage(item)}`});
    }
    if (item.activateTime && expiry > now && item.dataType === 1 && item.totalVolume > 0 && item.orderUsage / item.totalVolume > 0.9) {
      const left = Math.max(0,(1-item.orderUsage/item.totalVolume)*100);
      result.push({id:`low-data:${item.esimTranNo}:${item.totalVolume}`,resource:item.esimTranNo,kind:'low_data',text:`${label} · 剩余流量 ${(Math.floor(left * 10) / 10).toFixed(1)}%`});
    }
  }
  return result;
}

export function telegramReminderPayload(chatId, origin, batch) {
  const payload = {chat_id:chatId,text:`Yorke AI · eSIM 资源提醒\n\n${batch.map(row => row.text).join('\n')}`};
  if (batch.length === 1 && batch[0].kind === 'expiry') {
    const link = key => {
      const url = new URL('/',origin);
      url.searchParams.set(key,batch[0].resource);
      return url.href;
    };
    payload.reply_markup = {inline_keyboard:[
      [{text:'续订',url:link('renewEsim')}],
      [{text:'不续订并加入观察组',url:link('watchEsim')}],
    ]};
  }
  return payload;
}

export function makeResourceOperations({ root, config, mf, identities, readBody, outlook, purchases, wallet }) {
  const bindings = config.bindings || {};
  const archiveOrigins = new Set([config.origin, ...(config.aliasOrigins || [])]);
  const admins = new Set(String(bindings.RESOURCE_ADMIN_EMAILS || '').split(',').map(email => email.trim().toLowerCase()).filter(Boolean));
  const admin = user => user.role !== 'customer' && admins.has(user.email.toLowerCase());
  const json = (res, code, value) => { res.writeHead(code, { 'content-type':'application/json; charset=utf-8','cache-control':'private, no-store' }); res.end(JSON.stringify(value)); };
  const dispatch = (pathname, user) => mf.dispatchFetch(new URL(pathname,config.origin).href, { headers: trustedHeaders({}, user) });
  const progress = { everyMinutes: 30, lastCheckedAt: null, matched: 0, notified: 0, error: null, nextCheckAt: new Date(Date.now() + pollInterval).toISOString() };
  let checking = false;
  let manualDb, activeManual, closing = false;
  const exports = new Set();
  const mailLog = openEsimMailLog(root);
  const archives = openEsimArchives(root);
  const watches = openEsimWatches(root);

  async function overview(user) {
    const viewer = viewerFor(config,user);
    if (user.role === 'customer') {
      const {items,partial,available} = await purchases.customerProfiles(user);
      return {status:available ? 200 : 502,data:{
        connected:available, viewer, platform:'eSIMAccess',
        history:{total:items.length,items:items.map(customerHistoryItem)},
        ...(partial ? {error:'部分已购资源暂时无法同步，请稍后刷新。'} : {}),
        ...(available ? {syncedAt:new Date().toISOString()} : {}),
      }};
    }
    const reply = await dispatch('/api/esim/overview', user);
    const data = await reply.json();
    if (data.viewer) data.viewer = viewer;
    if (data.history?.items) data.history.items = data.history.items.map(decorate);
    return { status: reply.status, data };
  }

  async function mailRecords(user) {
    const reply = await dispatch('/api/mail-deliveries', user);
    const data = await reply.json();
    if (!reply.ok || !Array.isArray(data.records)) return { status: reply.status, data };
    const db = await mf.getD1Database('DB');
    const statement = db.prepare(`SELECT id, request_no AS name, user_email AS account, recipient_email AS recipientEmail,
      status, created_at AS createdAt, updated_at AS updatedAt FROM address_orders
      ${admin(user) ? '' : 'WHERE user_id = ?'} ORDER BY created_at DESC`);
    const { results } = await (admin(user) ? statement : statement.bind(user.id)).all();
    const records = results.map(({status,...row}) => ({ ...row, kind:'address_order', delivery: statusForMail[status] || statusForMail.waiting }));
    const recordTime = row => Date.parse(validTime(row.updatedAt) || validTime(row.createdAt)) || 0;
    data.records = [...data.records, ...records, ...mailLog.list(user,admin(user))].sort((a,b) => recordTime(b) - recordTime(a));
    return { status: reply.status, data };
  }

  async function route(req, res, url, user) {
    if (req.method === 'GET' && url.pathname === '/api/esim/topups') {
      const reply = await dispatch(url.pathname + url.search,user);
      const data = await reply.json();
      if (reply.ok && Array.isArray(data.items)) {
        const direct = purchases.usesSupplier(user);
        data.items = data.items.flatMap(item => {
          const priceRaw = esimPrice(item.priceRaw,user,direct);
          return priceRaw === null ? [] : [{...item,priceRaw,price:priceRaw/10_000}];
        });
      }
      json(res,reply.status,data); return true;
    }
    if (req.method === 'GET' && url.pathname === '/api/esim/overview') {
      await purchases.sync(user).catch(() => {});
      const {status,data} = await overview(user);
      const quota = await purchases.summary(user).catch(() => undefined);
      if (quota) data.esimQuota = quota;
      await purchases.reconcile(user,data.history?.items).catch(() => {});
      if (Array.isArray(data.history?.items)) {
        const archived = archives.list(user.id);
        const watched = watches.list();
        data.history.items = data.history.items.map(item => ({
          ...item,
          archivedAt: archived.get(item.esimTranNo) ?? null,
          watchedAt: watched.get(item.esimTranNo) ?? null,
        }));
      }
      json(res,status,data); return true;
    }
    if (['/api/esim/archive','/api/esim/watch'].includes(url.pathname)) {
      const observation = url.pathname === '/api/esim/watch';
      if (req.method !== 'POST') { json(res,405,{error:'请求方式不支持。'}); return true; }
      if (!archiveOrigins.has(req.headers.origin) || !/^application\/json\b/i.test(req.headers['content-type'] || '')) {
        json(res,403,{error:'请求来源不匹配。'}); return true;
      }
      let fields;
      try { fields = JSON.parse(await readBody(req,700_000)); } catch {}
      const enabled = observation ? fields?.watching : fields?.archived;
      if (!Array.isArray(fields?.ids) || !fields.ids.length || fields.ids.length > archiveBatchLimit
        || !fields.ids.every(isEsimId) || typeof enabled !== 'boolean') {
        const error = observation ? '请勾选要加入或移出观察组的 eSIM，单次最多 10,000 张。' : '请勾选要归档或恢复的 eSIM，单次最多 10,000 张。';
        json(res,400,{error}); return true;
      }
      const ids = [...new Set(fields.ids)];
      const result = await overview(user).catch(() => null);
      if (result?.status !== 200 || !Array.isArray(result.data.history?.items)) {
        json(res,502,{error:'暂时无法同步已购资源，请稍后重试。'}); return true;
      }
      const visible = new Set(result.data.history.items.map(item => item.esimTranNo));
      if (!ids.every(id => visible.has(id))) {
        json(res,403,{error:'所选资源已变更或当前账号无权访问。请刷新后重试。'}); return true;
      }
      const resultDate = observation ? {watchedAt:watches.set(ids,enabled)} : {archivedAt:archives.set(user.id,ids,enabled)};
      json(res,200,{ids,...resultDate}); return true;
    }
    if (req.method === 'GET' && url.pathname === '/api/mail-deliveries') {
      const {status,data} = await mailRecords(user); json(res,status,data); return true;
    }
    if (['/__host/accounts','/__host/accounts.css'].includes(url.pathname) && req.method === 'GET') {
      if (!canManageAccounts(config,user)) { json(res,403,{error:'仅超级管理员可管理合伙人与额度。'}); return true; }
      if (url.pathname.endsWith('.css')) {
        res.writeHead(200, {'content-type':'text/css; charset=utf-8','cache-control':'private, no-cache','x-content-type-options':'nosniff'});
        res.end(readFileSync(`${root}/resource-operations/accounts.css`)); return true;
      }
      res.writeHead(200, {'content-type':'text/html; charset=utf-8','cache-control':'private, no-store','content-security-policy':"default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; frame-ancestors 'none'; form-action 'self'"});
      res.end(withLocale(readFileSync(`${root}/resource-operations/accounts.html`))); return true;
    }
    if (url.pathname === '/__host/resource-operations.js' && req.method === 'GET') {
      res.writeHead(200, {'content-type':'application/javascript; charset=utf-8','cache-control':'private, no-store','x-content-type-options':'nosniff'});
      res.end(readFileSync(`${root}/resource-operations/portal.js`)); return true;
    }
    if (url.pathname === '/api/operations/accounts/discount') {
      if (!canManageAccounts(config,user)) { json(res,403,{error:'仅超级管理员可设置代理折扣。'}); return true; }
      if (req.method !== 'POST' || req.headers.origin !== config.origin || !/^application\/json\b/i.test(req.headers['content-type'] || '')) {
        json(res,405,{error:'请求方式不支持'}); return true;
      }
      let fields;
      try { fields=JSON.parse(await readBody(req)); }
      catch { json(res,400,{error:'无法读取账号资料'}); return true; }
      const email = typeof fields?.email === 'string' ? fields.email.trim().toLowerCase() : '';
      if (!email || (fields.discountBps !== null && !validDiscount(fields.discountBps))) {
        json(res,400,{error:'折扣比例请输入 0.01% 至 100%，或选择取消代理。'}); return true;
      }
      const account=identities.byEmail(email);
      if (!account || account.enabled === false || admin(account)) {
        json(res,404,{error:'请选中启用的合伙人或普通用户账号。'}); return true;
      }
      identities.setDiscount(account.id,fields.discountBps);
      json(res,200,{email:account.email,discountBps:fields.discountBps}); return true;
    }
    if (url.pathname === '/api/operations/accounts') {
      if (!canManageAccounts(config,user)) { json(res,403,{error:'仅超级管理员可管理合伙人与额度。'}); return true; }
      if (req.method === 'GET') {
        json(res,200,{accounts:identities.list().map(account => ({email:account.email,name:account.name,availableRaw:wallet.balance(account.id),enabled:account.enabled !== false,discountBps:admin(account) ? null : account.discountBps,admin:admin(account),role:admin(account) ? 'admin' : account.role === 'customer' ? 'customer' : 'employee'}))}); return true;
      }
      if (req.method === 'POST' && req.headers.origin === config.origin && /^application\/json\b/.test(req.headers['content-type'] || '')) {
        let fields;
        try { fields=JSON.parse(await readBody(req)); } catch { json(res,400,{error:'无法读取账号资料'}); return true; }
        if (typeof fields?.email === 'string' && admins.has(fields.email.trim().toLowerCase())) { json(res,409,{error:'该邮箱已预留为管理员账号。'}); return true; }
        const {status,...result}=identities.create(fields && typeof fields === 'object' ? fields : {});
        json(res,status,result); return true;
      }
      json(res,405,{error:'请求方式不支持'}); return true;
    }
    if (url.pathname === '/api/operations/reminders' && req.method === 'GET') {
      if (!admin(user)) { json(res,403,{error:'仅管理员可查看提醒状态'}); return true; }
      json(res,200,progress); return true;
    }
    if (url.pathname === '/api/operations/reminders/send-current') {
      const owner = directOwner();
      if (!owner || owner.id !== user.id || !canManageAccounts(config,user)) { json(res,403,{error:'仅超级管理员可发送当前续订提醒。'}); return true; }
      if (req.method !== 'POST') { json(res,405,{error:'请求方式不支持。'}); return true; }
      if (req.headers.origin !== config.origin || !/^application\/json\b/i.test(req.headers['content-type'] || '')) {
        json(res,403,{error:'请通过本站发送提醒。'}); return true;
      }
      let fields;
      try { fields = JSON.parse(await readBody(req,4096)); } catch {}
      if (typeof fields?.requestId !== 'string' || !manualReminderId.test(fields.requestId)) {
        json(res,400,{error:'缺少有效的提醒发送编号。'}); return true;
      }
      const result = await startManualReminders(owner,fields.requestId.toLowerCase());
      json(res,result.status,result.data); return true;
    }
    if (!['/api/esim/export','/api/esim/email'].includes(url.pathname)) return false;
    const email = url.pathname === '/api/esim/email';
    if (req.method !== 'POST' || req.headers.origin !== config.origin) { json(res,405,{error:'请求方式不支持'}); return true; }
    let ids, recipient, requestId;
    try { ({ids,recipient,requestId} = JSON.parse(await readBody(req, 80_000))); } catch { json(res,400,{error:'资源选择无效'}); return true; }
    if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || !ids.every(isEsimId)) { json(res,400,{error:'请勾选要导出的资源，单次最多 1,000 张。'}); return true; }
    const requested = new Set(ids);
    let sendKey;
    if (email) {
      const to = normalizeRecipient(recipient);
      if (!to || typeof requestId !== 'string' || !/^[0-9a-f-]{36}$/.test(requestId)) { json(res,400,{error:'请填写一个有效的收件邮箱。'}); return true; }
      sendKey = mailLog.sendKey(user,requestId,to,requested);
      const previous = mailLog.lookup(sendKey);
      if (previous) { json(res,previous.httpStatus,previous.data); return true; }
    }
    if (exports.has(user.id) || exports.size >= 3) { json(res,429,{error:'已有清单正在处理，请稍后再试。'}); return true; }
    exports.add(user.id);
    try {
      const history = await overview(user);
      if (history.status !== 200) { json(res,502,{error:'暂时无法同步已购资源，请稍后重试。'}); return true; }
      const selected = history.data.history.items.filter(item => requested.has(item.esimTranNo));
      if (new Set(selected.map(item => item.esimTranNo)).size !== requested.size) { json(res,403,{error:'所选资源已变更或当前账号无权访问。请刷新后重试。'}); return true; }
      if (email && !outlook) { json(res,503,{error:'Outlook 发件服务当前不可用。'}); return true; }
      const { buffer, embedded } = await makeEsimWorkbook(selected);
      if (email) {
        if (buffer.length > maxWorkbookBytes) { json(res,413,{error:'附件超过 Outlook 单封邮件的大小限制，请分批勾选后发送。'}); return true; }
        mailLog.begin(sendKey,selected.length,embedded);
        const result = await outlook.sendEsimWorkbook({to:sendKey.recipient,buffer,count:selected.length,embedded});
        mailLog.finish(sendKey,result);
        const recorded = mailLog.lookup(sendKey);
        json(res,recorded.httpStatus,recorded.data); return true;
      }
      res.writeHead(200, { 'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition':'attachment; filename="Lumen-eSIM.xlsx"', 'cache-control':'private, no-store','x-content-type-options':'nosniff','content-length':buffer.length,'x-lumen-qr-count':String(embedded) });
      res.end(buffer); return true;
    } finally { exports.delete(user.id); }
  }

  async function telegramSettings(db) {
    const row = await db.prepare("SELECT encrypted_value, iv FROM integration_settings WHERE key='telegram'").first();
    if (!row) return { botToken:bindings.TELEGRAM_BOT_TOKEN, chatId:bindings.TELEGRAM_CHAT_ID };
    const key = await webcrypto.subtle.importKey('raw',Buffer.from(bindings.SETTINGS_ENCRYPTION_KEY,'base64'),{name:'AES-GCM'},false,['decrypt']);
    const data = await webcrypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(row.iv,'base64')},key,Buffer.from(row.encrypted_value,'base64'));
    const state = JSON.parse(Buffer.from(data).toString('utf8'));
    return { botToken:state.botToken, chatId:bindings.TELEGRAM_CHAT_ID?.trim() || state.chatId };
  }

  function reminderRuns() {
    if (!manualDb) {
      manualDb = new DatabaseSync(path.join(root,'data','site-esim-reminder-runs.sqlite'));
      manualDb.exec(`PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS esim_reminder_runs (
          request_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, receipt TEXT NOT NULL
        ) WITHOUT ROWID`);
    }
    return manualDb;
  }

  // Both automatic and owner-requested reminders use the same callback builder and
  // message-ID binding. The owner-requested run requires an actual renewal callback.
  async function deliverReminder({settings,dedicated,user,batch,byId,canSend,requireDirect=false}) {
    if (!canSend()) return false;
    const payload = telegramReminderPayload(settings.chatId,config.origin,batch);
    const token = dedicated && batch[0].kind === 'expiry'
      ? await directActions.prepare(dedicated,user,batch[0],byId.get(batch[0].resource),payload) : null;
    if (requireDirect && (!token || payload.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data !== `yorke-esim:r:${token}`)) return false;
    if (!canSend()) return false;
    let response, result;
    try {
      response = await fetch(`https://api.telegram.org/bot${settings.botToken}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(12000)});
      result = await response.json();
    } catch {
      throw Object.assign(Error('Telegram 发送结果待确认'),{uncertain:true});
    }
    if (!response.ok || !result.ok) throw Error(`Telegram 发送失败 (${response.status})`);
    try { if (token) directActions.bind(token,result.result); }
    catch { throw Object.assign(Error('Telegram 提醒按钮绑定待确认'),{uncertain:true}); }
    return true;
  }

  async function startManualReminders(user,requestId) {
    if (closing) return {status:503,data:{error:'服务正在关闭，请稍后再试。'}};
    const store = reminderRuns();
    const previous = store.prepare('SELECT user_id,receipt FROM esim_reminder_runs WHERE request_id=?').get(requestId);
    const save = receipt => store.prepare('UPDATE esim_reminder_runs SET receipt=? WHERE request_id=?').run(JSON.stringify(receipt),requestId);
    if (previous) {
      if (previous.user_id !== user.id) return {status:403,data:{error:'请求编号不属于当前账号。'}};
      const data = JSON.parse(previous.receipt);
      if (data.status === 'running' && activeManual?.requestId !== requestId) {
        data.status = 'interrupted';
        if (data.inFlight) data.uncertain++;
        data.inFlight = false;
        data.error = '发送曾中断，请核对已收到的消息。同一编号不会再次发送。';
        save(data);
      }
      return {status:data.status === 'running' ? 202 : 200,data};
    }
    if (checking) return {status:409,data:{error:'已有提醒检查或发送尚未完成，请稍后再试。'}};
    checking = true;
    let db, shared, dedicated;
    try {
      db = await mf.getD1Database('DB');
      shared = await telegramSettings(db);
      dedicated = directActions.sessionFor(shared,user);
    } catch {}
    if (!dedicated || closing) {
      checking = false;
      return {status:503,data:{error:'独立续订机器人尚未就绪，未发送提醒。'}};
    }
    const receipt = {requestId,status:'running',matched:0,sent:0,skipped:0,failed:0,uncertain:0,inFlight:false};
    try {
      store.prepare('INSERT INTO esim_reminder_runs (request_id,user_id,receipt) VALUES (?,?,?)').run(requestId,user.id,JSON.stringify(receipt));
    } catch (error) { checking = false; throw error; }
    activeManual = {requestId};
    activeManual.promise = Promise.resolve().then(async () => {
      try {
        const received = await overview(user);
        if (received.status !== 200 || !Array.isArray(received.data.history?.items)) throw Error('暂时无法同步已购资源。');
        const items = received.data.history.items;
        const byId = new Map(items.map(item=>[item.esimTranNo,item]));
        const archived = archives.list(user.id);
        const candidates = [...new Map(esimReminderCandidates(items,Date.now(),watches.list())
          .filter(row=>row.kind==='expiry'&&!archived.has(row.resource)).map(row=>[row.resource,row])).values()];
        candidates.sort((a,b)=>Date.parse(byId.get(a.resource).expiredTime)-Date.parse(byId.get(b.resource).expiredTime));
        receipt.matched = candidates.length;
        save(receipt);
        let nextSendAt = 0;
        for (let index = 0; index < candidates.length; index++) {
          const row = candidates[index];
          const available = directActions.sessionFor(shared,user);
          if (closing || !available || available.botKey!==dedicated.botKey || available.actor!==dedicated.actor) {
            receipt.skipped += candidates.length-index;
            break;
          }
          const canSend = () => !closing && directActions.sessionFor(shared,user) === available &&
            !watches.has(row.resource) && !archives.list(user.id).has(row.resource);
          const pause = nextSendAt - Date.now();
          if (pause > 0) await new Promise(resolve=>setTimeout(resolve,pause));
          receipt.inFlight = true;
          save(receipt);
          try {
            const sent = await deliverReminder({settings:available,dedicated:available,user,batch:[row],byId,canSend,requireDirect:true});
            if (sent) {
              receipt.sent++;
              await db.batch([db.prepare('INSERT OR IGNORE INTO notification_log (id,resource_id,kind) VALUES (?,?,?)').bind(row.id,row.resource,row.kind)]).catch(()=>{});
            } else receipt.skipped++;
          } catch (error) {
            if (error?.uncertain) receipt.uncertain++;
            else receipt.failed++;
          }
          receipt.inFlight = false;
          save(receipt);
          nextSendAt = Date.now() + 1100;
        }
        receipt.status = 'completed';
      } catch {
        receipt.status = 'failed';
        receipt.error = '无法完成当前提醒发送，请核对已收到的消息。';
      } finally {
        try { save(receipt); } finally { checking = false; activeManual = null; }
      }
    }).catch(()=>{});
    return {status:202,data:receipt};
  }

  async function checkReminders({ send = false } = {}) {
    if (checking || closing) return;
    checking = true;
    try {
      const firstAdmin = identities.list().find(user => user.enabled !== false && admin(user));
      if (!firstAdmin) throw Error('无管理员账号');
      const db = await mf.getD1Database('DB');
      const shared = await telegramSettings(db);
      const owner = directOwner();
      const dedicated = owner ? directActions.sessionFor(shared,owner) : null;
      const user = dedicated ? owner : firstAdmin;
      const settings = dedicated || shared;
      if (!settings.botToken || !settings.chatId) throw Error('Telegram 尚未配置');
      const received = await overview(user);
      if (received.status !== 200 || !Array.isArray(received.data.history?.items)) throw Error('供应商数据不可用');
      const items = received.data.history.items;
      const byId = new Map(items.map(item=>[item.esimTranNo,item]));
      const records = esimReminderCandidates(items,Date.now(),watches.list());
      const fresh = [];
      for (const row of records) {
        if (!await db.prepare('SELECT id FROM notification_log WHERE id=?').bind(row.id).first()) fresh.push(row);
      }
      progress.lastCheckedAt = new Date().toISOString(); progress.matched = records.length; progress.notified = 0; progress.error = null;
      if (!send) return;
      // Telegram's per-chat limit is tighter for groups. Sending expiry notices
      // one card at a time must not turn a large renewal list into a burst.
      const spacing = String(settings.chatId).startsWith('-') ? 3100 : 1100;
      let nextSendAt = 0;
      async function sendBatch(batch) {
        const pause = nextSendAt - Date.now();
        if (pause > 0) await new Promise(resolve => setTimeout(resolve,pause));
        const canSend = () => !closing && (batch[0].kind !== 'expiry' || !watches.has(batch[0].resource));
        if (!await deliverReminder({settings,dedicated,user,batch,byId,canSend})) return;
        nextSendAt = Date.now() + spacing;
        await db.batch(batch.map(row => db.prepare('INSERT OR IGNORE INTO notification_log (id,resource_id,kind) VALUES (?,?,?)').bind(row.id,row.resource,row.kind)));
        progress.notified += batch.length;
      }
      // One expiry message per card keeps both buttons bound to the exact resource.
      for (const row of fresh.filter(row => row.kind === 'expiry')) {
        await sendBatch([row]);
      }
      const lowData = fresh.filter(row => row.kind === 'low_data');
      for (let i = 0; i < lowData.length; i += 12) await sendBatch(lowData.slice(i,i + 12));
    } catch (error) {
      progress.error = ['无管理员账号','Telegram 尚未配置','供应商数据不可用'].includes(error.message) || /^Telegram 发送失败 \(\d+\)$/.test(error.message) ? error.message : '检查失败，等待下次运行';
    } finally { checking = false; }
  }
  function directOwner() {
    const owners=identities.list().filter(user=>user.enabled!==false&&canManageAccounts(config,user));
    return owners.length===1?owners[0]:null;
  }
  const directActions=createTelegramDirectActions({root,config,currentAdmin:directOwner,
    loadSharedSettings:async()=>telegramSettings(await mf.getD1Database('DB')),purchases,watches,overview});
  progress.directActions=directActions.status;
  const initial = setTimeout(() => void checkReminders(), 5000);
  const timer = setInterval(() => {
    progress.nextCheckAt = new Date(Date.now() + pollInterval).toISOString();
    void checkReminders({send:true});
  },pollInterval);
  return { route, close() {
    closing = true;
    clearTimeout(initial); clearInterval(timer);
    const closeStores=()=>{ watches.close(); archives.close(); mailLog.close(); manualDb?.close(); };
    const stopping=directActions.close();
    if (stopping || activeManual) return Promise.allSettled([stopping,activeManual?.promise]).then(closeStores);
    closeStores();
  } };
}
