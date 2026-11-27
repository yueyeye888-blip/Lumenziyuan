import { randomUUID } from 'node:crypto';
import { createEsimSupplier, SupplierError } from './esim-supplier.mjs';
import { createEsimRenewals, renewalSchema } from './esim-renewals.mjs';

import { canManageAccounts } from './account-access.mjs';
import { esimPrice } from '../commerce/pricing.mjs';
import { paymentSchema, paymentIntent, getPayment, settlePayment, recoverPayments, settlePendingPayments, supplierAvailable } from './esim-commerce.mjs';

const supplierName = 'eSIMAccess';
const maximumCards = 30;
const validId = /^[a-zA-Z0-9_-]{1,100}$/;
const validRequestId = /^LH-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const now = () => new Date().toISOString();
const definiteFailures = {
  '000101':'供应商拒绝了接口鉴权，请联系管理员。',
  '000102':'供应商拒绝了接口鉴权，请联系管理员。',
  '000103':'供应商拒绝了接口请求，请联系管理员。',
  '000104':'供应商拒绝了接口请求，请联系管理员。',
  '000105':'供应商拒绝了订单参数，请联系管理员。',
  '000106':'供应商拒绝了订单参数，请联系管理员。',
  '000107':'供应商拒绝了订单参数，请联系管理员。',
  '101001':'供应商拒绝了接口鉴权，请联系管理员。',
  '101002':'供应商拒绝了接口鉴权，请联系管理员。',
  '101003':'供应商拒绝了接口鉴权，请联系管理员。',
  '200005':'供应商价格已变动，请重新获取报价。',
  '200006':'供应商价格已变动，请重新获取报价。',
  '200007':'eSIMAccess 主账号余额不足。',
  '200008':'供应商拒绝了订单参数，请联系管理员。',
  '200011':'供应商套餐库存不足，请更换套餐。',
  '310241':'该套餐已从供应商目录下架。',
  '310243':'该套餐已从供应商目录下架。',
};
class PurchaseError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function check(rule, status, message) {
  if (!rule) throw new PurchaseError(status, message);
}
function onlyIds(ids) {
  check(Array.isArray(ids) && ids.length > 0 && ids.length <= maximumCards &&
    ids.every(id => typeof id === 'string' && validId.test(id)) && new Set(ids).size === ids.length,
  400, '请选择有效套餐，每单最多购买 30 张。');
  return ids;
}
function orderInput(fields) {
  check(typeof fields?.id === 'string' && validRequestId.test(fields.id),
    400, '请核对订单编号。');
  check(Array.isArray(fields.items), 400, '请选择套餐。');
  onlyIds(fields.items.map(item => item?.id));
  check(fields.items.every(item => Number.isSafeInteger(item.count) && item.count >= 1 &&
    Number.isSafeInteger(item.priceRaw) && item.priceRaw >= 0) &&
    fields.items.reduce((count, item) => count + item.count, 0) <= maximumCards,
  400, '购买数量须为正整数，每单合计最多 30 张。');
  return fields;
}
export function createEsimPurchases({ config, mf, wallet, readBody, supplier = createEsimSupplier(config.bindings || {}) }) {
  const admins = new Set(String(config.bindings?.RESOURCE_ADMIN_EMAILS || '').split(',').map(email => email.trim().toLowerCase()).filter(Boolean));
  const isAdmin = user => user.role !== 'customer' && admins.has(user.email.toLowerCase());
  const usesSupplier = user => canManageAccounts(config,user);
  const priceFor = (cost,user) => esimPrice(cost,user,usesSupplier(user));
  const origins = new Set([config.origin, ...(config.aliasOrigins || [])]);
  let database;
  async function initialize() {
    const db = await mf.getD1Database('DB');
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS esim_purchase_orders (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, user_email TEXT NOT NULL, user_name TEXT NOT NULL,
        status TEXT NOT NULL, staff INTEGER NOT NULL, amount INTEGER NOT NULL, lines TEXT NOT NULL,
        order_no TEXT UNIQUE, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      )`),
      db.prepare('CREATE INDEX IF NOT EXISTS esim_purchase_orders_owner ON esim_purchase_orders(user_id,created_at)'),
      db.prepare('CREATE INDEX IF NOT EXISTS esim_purchase_orders_status ON esim_purchase_orders(status,created_at)'),
      ...renewalSchema(db), paymentSchema(db),
    ]);
    await recoverPayments(db,wallet);
    return db;
  }
  const dbReady = () => database ??= initialize().catch(error => { database = null; throw error; });
  let mutation = Promise.resolve();
  function serialize(fn) {
    const pending = mutation.then(fn);
    mutation = pending.catch(() => {});
    return pending;
  }

  const balanceFor = async (db, id) => {
    const row = await db.prepare('SELECT COALESCE(SUM(amount),0) AS total FROM quota_transactions WHERE platform=? AND user_id=?')
      .bind(supplierName,id).first();
    return row.total;
  };
  async function allocated(db) {
    const { total } = await db.prepare(`SELECT COALESCE(SUM(total),0) AS total FROM (
      SELECT user_id,SUM(amount) AS total FROM quota_transactions WHERE platform=? GROUP BY user_id HAVING total>0
    )`).bind(supplierName).first();
    return total;
  }
  function availability(user) {
    check(wallet,503,'账户余额服务暂不可用。');
    return wallet.balance(user.id);
  }

  let lastBalance, balanceRequest;
  async function refreshBalance() {
    const raw = await supplier.balance();
    lastBalance = { raw, at:Date.now() };
    return raw;
  }
  const invalidateBalance = () => { lastBalance = null; };

  async function supplierBalance(user) {
    if (!usesSupplier(user)) return null;
    const raw = lastBalance && Date.now() - lastBalance.at < 30_000
      ? lastBalance.raw
      : await (balanceRequest ??= refreshBalance().finally(() => { balanceRequest = null; }));
    return { balanceRaw:raw, availableRaw:await supplierAvailable(await dbReady(),raw) };
  }

  async function quoteBalance(db,user,raw) {
    const costAvailable = await supplierAvailable(db,raw);
    return usesSupplier(user)
      ? { paymentSource:'supplier', availableRaw:costAvailable, supplierBalanceRaw:raw }
      : { paymentSource:'wallet', availableRaw:Math.min(availability(user),priceFor(costAvailable,user) ?? Infinity) };
  }

  async function packageLines(db, user, ids, catalog) {
    const byId = new Map(catalog.map(plan => [plan.slug || plan.packageCode, plan]));
    let groupedItems = [];
    if (!isAdmin(user) && user.role !== 'customer') {
      // Group membership tags the acquired card for staff reporting. Funds and the
      // account balance determine the transaction independently of the catalog grouping.
      const slots = ids.map(() => '?').join(',');
      const codes = ids.map(id => byId.get(id)?.packageCode || '');
      const { results } = await db.prepare(`SELECT i.product_id,i.package_code,i.group_id FROM resource_group_items i
        JOIN resource_groups g ON g.id=i.group_id
        WHERE i.supplier=? AND (i.product_id IN (${slots}) OR i.package_code IN (${slots}))
        ORDER BY i.group_id`).bind(supplierName,...ids,...codes).all();
      groupedItems = results;
    }
    return ids.map(id => {
      const plan = byId.get(id);
      const priceRaw = priceFor(plan?.price,user);
      check(plan && validId.test(plan.packageCode || '') && plan.currencyCode === 'USD' && priceRaw !== null,
        409, '所选套餐当前不可购买，请刷新资源市场。');
      const group = groupedItems.find(item => item.product_id === id) || groupedItems.find(item => item.package_code === plan.packageCode);
      return { id, code:plan.slug || plan.packageCode, packageCode:plan.packageCode, name:plan.name,
        priceRaw, costRaw:plan.price, periodNum:Number(plan.dataType) === 2 && plan.duration === 1 ? 1 : undefined, groupId:group?.group_id || null };
    });
  }

  const getOrder = (db,id) => db.prepare('SELECT * FROM esim_purchase_orders WHERE id=?').bind(id).first();
  function present(row) {
    const adminView = { account:row.user_email, name:row.user_name };
    const items = JSON.parse(row.lines).map(({ id, name, count, priceRaw }) => ({ id, name, count, priceRaw }));
    return { ...adminView, id:row.id, status:['preparing','submitting'].includes(row.status) ? 'uncertain' : row.status,
      orderNo:row.order_no, amountRaw:row.amount, items, error:row.error, createdAt:row.created_at, retryAfter: new Date(Date.parse(row.updated_at)+30_000).toISOString() };
  }
  const unresolved = (db,user) => db.prepare(`SELECT * FROM esim_purchase_orders
    WHERE user_id=? AND status IN ('preparing','submitting','uncertain') ORDER BY created_at DESC LIMIT 1`).bind(user.id).first();

  async function quote(db,user,ids) {
    const pending = await unresolved(db,user);
    if (pending) return { pending:{ ...present(pending), canRetry:true } };
    const [catalog, rawBalance] = await Promise.all([supplier.catalog(), refreshBalance()]);
    return {
      lines:(await packageLines(db,user,onlyIds(ids),catalog)).map(({ id, name, priceRaw, periodNum }) => ({ id,name,priceRaw,periodNum })),
      ...await quoteBalance(db,user,rawBalance),
      maxCards:maximumCards, currency:'USD',
    };
  }

  async function recordAccepted(db,row,orderNo) {
    const changes = [];
    if (row.staff && !await getPayment(db,row.id)) {
      const left = await balanceFor(db,row.user_id) - row.amount;
      changes.push(db.prepare(`INSERT INTO quota_transactions(id,user_id,platform,kind,amount,balance_after,reference,note,created_at)
        VALUES(?,?,?,?,?,?,?,?,?)`).bind(row.id,row.user_id,supplierName,'购买',-row.amount,left,orderNo,'eSIMAccess 实际下单',now()));
    }
    changes.push(db.prepare(`UPDATE esim_purchase_orders SET status='allocating',order_no=?,error=NULL,updated_at=? WHERE id=?`)
      .bind(orderNo,now(),row.id));
    await db.batch(changes);
    await settlePayment(db,wallet,row.id);
  }

  async function submit(db,user,fields) {
    const { id, items } = orderInput(fields);
    return serialize(async () => {
      const existing = await getOrder(db,id);
      if (existing) {
        check(existing.user_id === user.id, 404, '订单未找到。');
        await settlePayment(db,wallet,id);
        return present(existing);
      }
      check(!await unresolved(db,user),409,'有一笔订单正在核对，请先查看购买记录。');
      const [catalog, balance] = await Promise.all([supplier.catalog(), refreshBalance()]);
      const lines = (await packageLines(db,user,items.map(item => item.id),catalog)).map((line,index) => {
        const { priceRaw, count } = items[index];
        check(line.priceRaw === priceRaw,409,'订单价格已变动，请重新获取报价。');
        return { ...line,count };
      });
      const amount = lines.reduce((sum,line) => sum+line.priceRaw*line.count,0);
      const cost = lines.reduce((sum,line)=>sum + line.costRaw*line.count,0);
      check(Number.isSafeInteger(amount) && Number.isSafeInteger(cost),400,'订单金额无效。');
      const direct = usesSupplier(user);
      const walletAmount = direct ? 0 : amount;
      if (!direct) check(walletAmount <= availability(user),402,'账户余额不足，请先充值。');
      check(cost <= await supplierAvailable(db,balance),409,
        direct ? 'eSIMAccess 供应商账户可用余额不足。' : '供应商暂时无法接受此金额的订单。');
      const timestamp = now();
      await db.batch([
        db.prepare(`INSERT INTO esim_purchase_orders(id,user_id,user_email,user_name,status,staff,amount,lines,created_at,updated_at)
          VALUES(?,?,?,?,'preparing',?,?,?,?,?)`).bind(id,user.id,user.email,user.name || user.email,isAdmin(user)?0:1,amount,JSON.stringify(lines),timestamp,timestamp),
        paymentIntent(db,id,user.id,cost,walletAmount),
      ]);
      try {
        if (walletAmount) wallet.reserve(user.id,id,walletAmount);
        await db.prepare("UPDATE esim_purchase_orders SET status='submitting',updated_at=? WHERE id=?").bind(now(),id).run();
      } catch (error) {
        // No supplier call has been made yet.
        await db.prepare("UPDATE esim_purchase_orders SET status='rejected',error='余额预留失败，订单未发送。',updated_at=? WHERE id=?").bind(now(),id).run();
        await settlePayment(db,wallet,id);
        throw error;
      }
      return sendOrder(db,await getOrder(db,id));
    });
  }

  async function sendOrder(db,row,retry=false) {
    let orderNo;
    try {
      const lines = JSON.parse(row.lines).map(line => ({...line,priceRaw:line.costRaw ?? line.priceRaw}));
      const cost = lines.reduce((sum,line)=>sum+line.priceRaw*line.count,0);
      orderNo = await supplier.order(row.id,lines,cost);
    } catch (error) {
      const rejection = !retry && error instanceof SupplierError && Object.hasOwn(definiteFailures,error.code) ? definiteFailures[error.code] : null;
      await db.prepare('UPDATE esim_purchase_orders SET status=?,error=?,updated_at=? WHERE id=?')
        .bind(rejection?'rejected':'uncertain',rejection,now(),row.id).run();
      await settlePayment(db,wallet,row.id);
      return present(await getOrder(db,row.id));
    } finally {
      invalidateBalance();
    }
    await recordAccepted(db,row,orderNo);
    return present(await getOrder(db,row.id));
  }

  async function retryOrder(db,user,fields) {
    check(typeof fields.id === 'string' && validRequestId.test(fields.id),400,'订单编号无效。');
    return serialize(async () => {
      const row = await getOrder(db,fields.id);
      check(row?.user_id === user.id,404,'订单未找到。');
      if (!['submitting','uncertain'].includes(row.status)) return present(row);
      check(Date.now() - Date.parse(row.updated_at) >= 30_000,429,'请等待 30 秒后再尝试核对该单。');
      const lines = JSON.parse(row.lines);
      const current = await packageLines(db,user,lines.map(line=>line.id),await supplier.catalog());
      check(current.every((line,index)=>line.code===lines[index].code && line.costRaw===(lines[index].costRaw ?? lines[index].priceRaw) &&
        line.periodNum===lines[index].periodNum),409,'套餐或价格已变动，请先在供应商后台核对此单。');
      await db.prepare('UPDATE esim_purchase_orders SET updated_at=? WHERE id=?').bind(now(),row.id).run();
      // Reuse the exact supplier transaction ID, lines and amounts.
      return sendOrder(db,row,true);
    });
  }

  const syncAfter = new Map();
  async function syncOrder(db,row) {
    if (syncAfter.size > 256) for (const [id,time] of syncAfter) if (time <= Date.now()) syncAfter.delete(id);
    if (syncAfter.get(row.id) > Date.now()) return;
    syncAfter.set(row.id,Date.now()+8_000);
    try {
      const profiles = (await supplier.profiles(row.order_no)).filter(profile => profile.orderNo === row.order_no &&
        typeof profile.esimTranNo === 'string' && validId.test(profile.esimTranNo));
      const unique = [...new Map(profiles.map(profile => [profile.esimTranNo,profile])).values()];
      const lines = JSON.parse(row.lines);
      const count = lines.reduce((sum,line) => sum+line.count,0);
      if (!unique.length || unique.length > count) return;
      const inserts = unique.map(profile => {
        const packageCode = profile.packageList?.[0]?.packageCode;
        const group = lines.find(line => line.packageCode === packageCode)?.groupId || null;
        return db.prepare(`INSERT OR IGNORE INTO resource_ownership(resource_id,supplier,order_no,owner_user_id,owner_email,owner_name,group_id)
          VALUES(?,?,?,?,?,?,?)`).bind(profile.esimTranNo,supplierName,row.order_no,row.user_id,row.user_email,row.user_name,group);
      });
      await db.batch(inserts);
      const { total } = await db.prepare('SELECT COUNT(*) AS total FROM resource_ownership WHERE supplier=? AND order_no=? AND owner_user_id=?')
        .bind(supplierName,row.order_no,row.user_id).first();
      if (total === count) {
        await db.prepare("UPDATE esim_purchase_orders SET status='ready',updated_at=? WHERE id=?").bind(now(),row.id).run();
        syncAfter.delete(row.id);
      }
    } catch (error) {
      if (!(error instanceof SupplierError && error.code === '200010')) console.warn('eSIM purchase profile sync pending');
    }
  }
  async function sync(user) {
    const db = await dbReady();
    const statement = db.prepare(`SELECT * FROM esim_purchase_orders WHERE status='allocating'
      AND (?=1 OR user_id=?) ORDER BY updated_at LIMIT 4`).bind(isAdmin(user)?1:0,user.id);
    const { results } = await statement.all();
    await Promise.all(results.map(row => syncOrder(db,row)));
  }

  // The supplier's existing account-wide history can also resolve an interrupted order.
  async function reconcile(user, history) {
    if (!isAdmin(user) || !Array.isArray(history)) return;
    const byTransaction = new Map(history.filter(item => /^LH-/.test(item.transactionId || '') &&
      typeof item.orderNo === 'string' && validId.test(item.orderNo)).map(item => [item.transactionId,item.orderNo]));
    if (!byTransaction.size) return;
    const db = await dbReady();
    for (const [id,orderNo] of byTransaction) {
      await serialize(async () => {
        const row = await getOrder(db,id);
        if (row && ['submitting','uncertain'].includes(row.status)) await recordAccepted(db,row,orderNo);
      });
    }
  }

  async function purchaseCards(db,user,id) {
    check(validRequestId.test(id || ''),404,'订单未找到。');
    const row = await getOrder(db,id);
    check(row && (row.user_id === user.id || isAdmin(user)),404,'订单未找到。');
    if (!row.order_no) return {cards:[]};
    if (row.status === 'allocating') await syncOrder(db,row);
    const {results} = await db.prepare(`SELECT resource_id FROM resource_ownership
      WHERE supplier=? AND owner_user_id=? AND order_no=?`).bind(supplierName,row.user_id,row.order_no).all();
    const ids = new Set(results.map(item=>item.resource_id));
    if (!ids.size) return {cards:[]};
    const profiles = await supplier.profiles(row.order_no);
    return {cards:profiles.filter(card=>card.orderNo===row.order_no && ids.has(card.esimTranNo)).map(card=>({
      resourceId:card.esimTranNo, iccid:card.iccid || null, activationCode:card.ac || null,
      qrCodeUrl:typeof card.qrCodeUrl==='string' && /^https:\/\//i.test(card.qrCodeUrl) ? card.qrCodeUrl : null,
      expiresAt:card.expiredTime || null, name:card.packageList?.[0]?.packageName || 'eSIM',
    }))};
  }

  const customerLookups = new Map();
  async function fetchCustomerProfiles(user) {
    const db = await dbReady();
    const {results} = await db.prepare(`SELECT o.resource_id,o.order_no,s.status,s.note,s.recheck_at
      FROM resource_ownership o LEFT JOIN resource_status_overrides s
      ON s.id=o.supplier||':'||o.resource_id
      WHERE o.owner_user_id=? AND o.supplier=? ORDER BY o.created_at DESC`)
      .bind(user.id,supplierName).all();
    const byOrder = new Map();
    const lookups = [];
    for (const row of results) {
      if (!validId.test(row.resource_id)) continue;
      if (!row.order_no || !validId.test(row.order_no)) {
        lookups.push(async () => {
          const profile = await supplier.profile(row.resource_id);
          return profile?.esimTranNo === row.resource_id ? [{profile,override:row}] : [];
        });
        continue;
      }
      if (!byOrder.has(row.order_no)) byOrder.set(row.order_no,new Map());
      byOrder.get(row.order_no).set(row.resource_id,row);
    }
    for (const [number, owned] of byOrder) {
      lookups.push(async () => {
        const profiles = await supplier.profiles(number);
        return profiles.flatMap(profile => profile.orderNo === number && owned.has(profile.esimTranNo)
          ? [{profile,override:owned.get(profile.esimTranNo)}] : []);
      });
    }
    const matches = new Map();
    let failures = 0;
    for (let start=0; start<lookups.length; start+=3) {
      const batch = await Promise.allSettled(lookups.slice(start,start+3).map(lookup => lookup()));
      for (const response of batch) {
        if (response.status === 'rejected') failures++;
        else for (const matched of response.value) matches.set(matched.profile.esimTranNo,matched);
      }
      if (start+3<lookups.length) await new Promise(resolve=>setTimeout(resolve,500));
    }
    const items = results.map(row=>matches.get(row.resource_id)).filter(Boolean);
    return {items, partial: items.length < results.length, available: !lookups.length || failures < lookups.length};
  }

  function customerProfiles(user) {
    if (!customerLookups.has(user.id)) {
      customerLookups.set(user.id,fetchCustomerProfiles(user).finally(()=>customerLookups.delete(user.id)));
    }
    return customerLookups.get(user.id);
  }

  const renewals = createEsimRenewals({ supplier,dbReady,serialize,isAdmin,availability,wallet,check,
    definiteFailures,supplierName, usesSupplier, priceFor, quoteBalance, refreshBalance, invalidateBalance });
  const renewalPaths = new Set(['/api/esim/renewal-quote','/api/esim/renewals']);
  const paths = new Set(['/api/esim/purchase-quote','/api/esim/purchases','/api/esim/purchase-quota','/api/esim/purchase-cards',...renewalPaths]);
  async function route(req,res,url,user) {
    if (!paths.has(url.pathname)) return false;
    const respond = (status,body) => {
      res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store'});
      res.end(JSON.stringify(body));
      return true;
    };
    try {
      const quota = url.pathname === '/api/esim/purchase-quota';
      const renewal = renewalPaths.has(url.pathname);
      if (quota) {
        check(isAdmin(user),403,'仅管理员可管理账户余额。');
        return respond(410,{error:'请从合伙人与额度页面管理账户余额。',href:'/__host/accounts'});
      }
      if (url.pathname==='/api/esim/purchase-cards') {
        check(req.method==='GET',405,'请求方式不支持。');
        return respond(200,await purchaseCards(await dbReady(),user,url.searchParams.get('id')));
      }
      if (req.method === 'POST') {
        check(origins.has(req.headers.origin) && /^application\/json\b/i.test(req.headers['content-type'] || ''),
          403,'请求来源不匹配。');
        let fields;
        try { fields = JSON.parse(await readBody(req,16_384)); } catch { throw new PurchaseError(400,'请求格式无效。'); }
        if (renewal) {
          return url.pathname.endsWith('renewal-quote') ? respond(200,await renewals.quote(user,fields)) :
            respond(202,await renewals.submit(user,fields));
        }
        const db = await dbReady();
        if (url.pathname.endsWith('purchase-quote')) return respond(200,await quote(db,user,onlyIds(fields?.ids)));
        const order = fields?.retry === true ? await retryOrder(db,user,fields) : await submit(db,user,fields);
        return respond(order.status === 'rejected' ? 409 : order.status === 'ready' ? 200 : 202,{ order:{ ...order, canRetry:true } });
      }
      if (req.method === 'GET' && url.pathname.endsWith('/renewals')) return respond(200,await renewals.history(user,url.searchParams));
      if (req.method === 'GET' && url.pathname.endsWith('/purchases')) {
        const db = await dbReady();
        const id = url.searchParams.get('id');
        if (id) {
          check(validRequestId.test(id),404,'订单未找到。');
          let row = await getOrder(db,id);
          check(row && (isAdmin(user) || row.user_id === user.id),404,'订单未找到。');
          await settlePayment(db,wallet,row.id);
          if (row.status === 'allocating') {
            await syncOrder(db,row);
            row = await getOrder(db,id);
          }
          return respond(200,{ order:{ ...present(row), canRetry: row.user_id === user.id } });
        }
        const offsetValue = url.searchParams.get('offset') || '0';
        check(/^\d{1,7}$/.test(offsetValue),400,'订单页码无效。');
        await sync(user);
        const { results } = await db.prepare(`SELECT * FROM esim_purchase_orders
          WHERE (?=1 OR user_id=?) ORDER BY created_at DESC,id DESC LIMIT 31 OFFSET ?`)
          .bind(isAdmin(user)?1:0,user.id,Number(offsetValue)).all();
        return respond(200,{ orders:results.slice(0,30).map(present), hasMore:results.length>30 });
      }
      return respond(405,{error:'请求方式不支持。'});
    } catch (error) {
      if (error instanceof PurchaseError || error?.status === 402) return respond(error.status,{ error:error.message });
      if (renewalPaths.has(url.pathname)) {
        console.warn('eSIM renewal request unavailable');
        return respond(503,{error:'续费服务暂时不可用。已提交的请求请到续费记录中核对。'});
      }
      console.warn('eSIM purchase request unavailable');
      return respond(503,{ error:'购买服务暂时不可用。如已确认支付，请打开购买记录核对。' });
    }
  }
  async function summary(user) {
    const db = await dbReady();
    const direct = usesSupplier(user);
    const balance = direct ? await supplierBalance(user).catch(() => null) : null;
    return {
      paymentSource: direct ? 'supplier' : 'wallet',
      availableRaw: direct ? balance?.availableRaw ?? null : availability(user),
      ...(direct ? {supplierBalanceRaw:balance?.balanceRaw ?? null} : {}),
      ...(isAdmin(user) ? {allocatedRaw:await allocated(db)} : {}),
    };
  }
  const settle = async () => settlePendingPayments(await dbReady(),wallet);
  return {
    route,summary,sync,reconcile,settle,usesSupplier,supplierBalance,customerProfiles,ready:dbReady,
    previewReminderRenewal:renewals.previewReminderRenewal,renewFromTelegram:renewals.renewFromTelegram,
    telegramRenewalHistory:renewals.telegramRenewalHistory,telegramRenewalId:renewals.telegramRenewalId,
  };
}
