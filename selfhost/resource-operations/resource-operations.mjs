import { canManageAccounts, viewerFor } from './account-access.mjs';
import { esimPrice, validDiscount } from '../commerce/pricing.mjs';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { trustedHeaders } from './auth.mjs';
import { makeEsimWorkbook } from './esim-export.mjs';
import { openEsimMailLog, normalizeRecipient } from './esim-mail-log.mjs';
import { maxWorkbookBytes } from '../outlook-mail.mjs';

const day = 86_400_000;
const pollInterval = 30 * 60_000;
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

export function makeResourceOperations({ root, config, mf, identities, readBody, outlook, purchases, wallet }) {
  const bindings = config.bindings || {};
  const admins = new Set(String(bindings.RESOURCE_ADMIN_EMAILS || '').split(',').map(email => email.trim().toLowerCase()).filter(Boolean));
  const admin = user => user.role !== 'customer' && admins.has(user.email.toLowerCase());
  const json = (res, code, value) => { res.writeHead(code, { 'content-type':'application/json; charset=utf-8','cache-control':'private, no-store' }); res.end(JSON.stringify(value)); };
  const dispatch = (pathname, user) => mf.dispatchFetch(new URL(pathname,config.origin).href, { headers: trustedHeaders({}, user) });
  const progress = { everyMinutes: 30, lastCheckedAt: null, matched: 0, notified: 0, error: null, nextCheckAt: new Date(Date.now() + pollInterval).toISOString() };
  let checking = false;
  const exports = new Set();
  const mailLog = openEsimMailLog(root);

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
    data.records = [...data.records, ...records, ...mailLog.list(user,admin(user))].sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt)));
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
      json(res,status,data); return true;
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
      res.end(readFileSync(`${root}/resource-operations/accounts.html`)); return true;
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
    if (!['/api/esim/export','/api/esim/email'].includes(url.pathname)) return false;
    const email = url.pathname === '/api/esim/email';
    if (req.method !== 'POST' || req.headers.origin !== config.origin) { json(res,405,{error:'请求方式不支持'}); return true; }
    let ids, recipient, requestId;
    try { ({ids,recipient,requestId} = JSON.parse(await readBody(req, 80_000))); } catch { json(res,400,{error:'资源选择无效'}); return true; }
    if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || ids.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id))) { json(res,400,{error:'请勾选要导出的资源，单次最多 1,000 张。'}); return true; }
    const requested = new Set(ids);
    let sendKey;
    if (email) {
      const to = normalizeRecipient(recipient);
      if (!to || typeof requestId !== 'string' || !/^[0-9a-f-]{36}$/.test(requestId)) { json(res,400,{error:'请填写一个有效的收件邮箱。'}); return true; }
      sendKey = mailLog.sendKey(user,requestId,to,requested);
      const previous = mailLog.lookup(sendKey);
      if (previous) { json(res,previous.httpStatus,previous.data); return true; }
      if (!outlook) { json(res,503,{error:'Outlook 发件服务当前不可用。'}); return true; }
    }
    if (exports.has(user.id) || exports.size >= 3) { json(res,429,{error:'已有清单正在处理，请稍后再试。'}); return true; }
    exports.add(user.id);
    try {
      const history = await overview(user);
      if (history.status !== 200) { json(res,502,{error:'暂时无法同步已购资源，请稍后重试。'}); return true; }
      const selected = history.data.history.items.filter(item => requested.has(item.esimTranNo));
      if (new Set(selected.map(item => item.esimTranNo)).size !== requested.size) { json(res,403,{error:'所选资源已变更或当前账号无权访问。请刷新后重试。'}); return true; }
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
  function candidates(items, now) {
    const result = [];
    for (const item of items) {
      if (['USED_EXPIRED','UNUSED_EXPIRED','CANCEL','REVOKED'].includes(item.esimStatus) || ['DELETED','REVOKED'].includes(item.smdpStatus)) continue;
      const expiry = Date.parse(item.expiredTime);
      const masked = item.iccid ? `••••${item.iccid.slice(-4)}` : '—';
      const label = `${String(item.packageName).slice(0,100)} · ${masked}`;
      if (expiry > now && expiry <= now + 5 * day) result.push({id:`expiry:${item.esimTranNo}:${item.expiredTime}`,resource:item.esimTranNo,kind:'expiry',text:`${label} · ${item.expiryKind === 'activation' ? '最晚激活' : '套餐到期'} ${lastDate.format(expiry)}（UTC+8）`});
      if (item.activateTime && expiry > now && item.dataType === 1 && item.totalVolume > 0 && item.orderUsage / item.totalVolume > 0.9) {
        const left = Math.max(0,(1-item.orderUsage/item.totalVolume)*100);
        result.push({id:`low-data:${item.esimTranNo}:${item.totalVolume}`,resource:item.esimTranNo,kind:'low_data',text:`${label} · 剩余流量 ${(Math.floor(left * 10) / 10).toFixed(1)}%`});
      }
    }
    return result;
  }
  async function checkReminders({ send = false } = {}) {
    if (checking) return;
    checking = true;
    try {
      const user = identities.list().find(user => user.enabled !== false && admin(user));
      if (!user) throw Error('无管理员账号');
      const db = await mf.getD1Database('DB');
      const settings = await telegramSettings(db);
      if (!settings.botToken || !settings.chatId) throw Error('Telegram 尚未配置');
      const received = await overview(user);
      if (received.status !== 200 || !Array.isArray(received.data.history?.items)) throw Error('供应商数据不可用');
      const records = candidates(received.data.history.items,Date.now());
      const fresh = [];
      for (const row of records) {
        if (!await db.prepare('SELECT id FROM notification_log WHERE id=?').bind(row.id).first()) fresh.push(row);
      }
      progress.lastCheckedAt = new Date().toISOString(); progress.matched = records.length; progress.notified = 0; progress.error = null;
      if (!send) return;
      for (let i = 0; i < fresh.length; i += 12) {
        const batch = fresh.slice(i, i + 12);
        const response = await fetch(`https://api.telegram.org/bot${settings.botToken}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:settings.chatId,text:`Lumen · eSIM 资源提醒\n\n${batch.map(row => row.text).join('\n')}`}),signal:AbortSignal.timeout(12000)});
        if (!response.ok || !(await response.json()).ok) throw Error(`Telegram 发送失败 (${response.status})`);
        await db.batch(batch.map(row => db.prepare('INSERT OR IGNORE INTO notification_log (id,resource_id,kind) VALUES (?,?,?)').bind(row.id,row.resource,row.kind)));
        progress.notified += batch.length;
      }
    } catch (error) {
      progress.error = ['无管理员账号','Telegram 尚未配置','供应商数据不可用'].includes(error.message) || /^Telegram 发送失败 \(\d+\)$/.test(error.message) ? error.message : '检查失败，等待下次运行';
    } finally { checking = false; }
  }
  const initial = setTimeout(() => void checkReminders(), 5000);
  const timer = setInterval(() => {
    progress.nextCheckAt = new Date(Date.now() + pollInterval).toISOString();
    void checkReminders({send:true});
  },pollInterval);
  return { route, close() { clearTimeout(initial); clearInterval(timer); mailLog.close(); } };
}
