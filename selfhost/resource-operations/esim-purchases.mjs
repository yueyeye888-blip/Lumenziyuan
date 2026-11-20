import { pbkdf2, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { createEsimSupplier, SupplierError } from './esim-supplier.mjs';
import { createEsimRenewals, renewalSchema } from './esim-renewals.mjs';

const derive = promisify(pbkdf2);
const supplierName = 'eSIMAccess';
const maximumCards = 30;
const validId = /^[a-zA-Z0-9_-]{1,100}$/;
const validRequestId = /^LH-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const validPin = pin => typeof pin === 'string' && /^\d{6}$/.test(pin);
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
  check(typeof fields?.id === 'string' && validRequestId.test(fields.id) && validPin(fields.pin),
    400, '请填写 6 位支付密码并核对订单。');
  check(Array.isArray(fields.items), 400, '请选择套餐。');
  onlyIds(fields.items.map(item => item?.id));
  check(fields.items.every(item => Number.isSafeInteger(item.count) && item.count >= 1 &&
    Number.isSafeInteger(item.priceRaw) && item.priceRaw >= 0) &&
    fields.items.reduce((count, item) => count + item.count, 0) <= maximumCards,
  400, '购买数量须为正整数，每单合计最多 30 张。');
  return fields;
}
function quotaInput(fields) {
  check(typeof fields?.email === 'string' && typeof fields.amount === 'string' &&
    /^\d{1,8}(?:\.\d{1,4})?$/.test(fields.amount) && Number.isSafeInteger(fields.expectedRaw) && fields.expectedRaw >= 0,
  400, '请输入有效的美元额度，最多 4 位小数。');
  return { email:fields.email.trim().toLowerCase(), target:Math.round(Number(fields.amount) * 10_000), expectedRaw:fields.expectedRaw };
}

export function createEsimPurchases({ config, mf, identities, readBody, supplier = createEsimSupplier(config.bindings || {}) }) {
  const admins = new Set(String(config.bindings?.RESOURCE_ADMIN_EMAILS || '').split(',').map(email => email.trim().toLowerCase()).filter(Boolean));
  const isAdmin = user => admins.has(user.email.toLowerCase());
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
      ...renewalSchema(db),
    ]);
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
  async function reserved(db, filter, ...parameters) {
    const { total } = await db.prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM (
      SELECT amount,staff,user_id FROM esim_purchase_orders WHERE status IN ('submitting','uncertain')
      UNION ALL
      SELECT amount,staff,user_id FROM esim_renewal_lines WHERE status IN ('queued','submitting','uncertain')
    ) WHERE ${filter}`).bind(...parameters).first();
    return total;
  }
  async function availability(db, user, suppliedBalance) {
    if (isAdmin(user)) return Math.max(0, suppliedBalance - await allocated(db) - await reserved(db,'staff=0'));
    return Math.max(0, Math.min(suppliedBalance, await balanceFor(db,user.id) - await reserved(db,'user_id=?',user.id)));
  }

  async function packageLines(db, user, ids, catalog) {
    const byId = new Map(catalog.map(plan => [plan.slug || plan.packageCode, plan]));
    let memberships;
    if (!isAdmin(user)) {
      const { results } = await db.prepare(`SELECT i.product_id,i.package_code,i.group_id FROM resource_group_items i
        JOIN resource_group_members m ON m.group_id=i.group_id JOIN resource_groups g ON g.id=i.group_id
        WHERE i.supplier=? AND m.user_email=? AND m.can_purchase=1 ORDER BY i.group_id`).bind(supplierName,user.email.toLowerCase()).all();
      memberships = results;
    }
    return ids.map(id => {
      const plan = byId.get(id);
      check(plan && validId.test(plan.packageCode || '') && Number.isSafeInteger(plan.price) &&
        plan.price >= 0 && plan.currencyCode === 'USD', 409, '所选套餐当前不可购买，请刷新资源市场。');
      const group = memberships?.find(item => item.product_id === id || item.package_code === plan.packageCode);
      check(isAdmin(user) || group, 403, '当前账号没有购买所选套餐的权限。');
      return { id, code:plan.slug || plan.packageCode, packageCode:plan.packageCode, name:plan.name,
        priceRaw:plan.price, periodNum:Number(plan.dataType) === 2 && plan.duration === 1 ? 1 : undefined, groupId:group?.group_id || null };
    });
  }

  async function verifyPaymentPin(db, user, pin, security) {
    check(security, 409, '请先到「安全与支付设置」设置 6 位支付密码。');
    check(!(Date.parse(security.locked_until) > Date.now()), 429, '支付密码已锁定，请 15 分钟后再试。');
    const attempts = security.locked_until ? 0 : security.failed_attempts;
    const expected = Buffer.from(security.pin_hash, 'base64');
    const actual = await derive(pin, Buffer.from(security.pin_salt,'base64'), 210_000, 32, 'sha256');
    if (expected.length !== actual.length || !timingSafeEqual(expected,actual)) {
      const lockedUntil = attempts + 1 >= 5 ? new Date(Date.now() + 15 * 60_000).toISOString() : null;
      await db.prepare('UPDATE user_security SET failed_attempts=?,locked_until=? WHERE user_id=?').bind(attempts+1,lockedUntil,user.id).run();
      throw new PurchaseError(lockedUntil ? 429 : 400, lockedUntil ? '支付密码已锁定，请 15 分钟后再试。' : '支付密码不正确。');
    }
    if (security.failed_attempts || security.locked_until) {
      await db.prepare('UPDATE user_security SET failed_attempts=0,locked_until=NULL WHERE user_id=?').bind(user.id).run();
    }
  }
  const readSecurity = (db,user) => db.prepare('SELECT * FROM user_security WHERE user_id=?').bind(user.id).first();
  async function updateSecurity(db, user, fields) {
    return serialize(async () => {
      check(validPin(fields?.newPin),400,'支付密码必须是 6 位数字。');
      const security = await readSecurity(db,user);
      if (security) {
        check(validPin(fields.currentPin),400,'请输入当前 6 位支付密码。');
        await verifyPaymentPin(db,user,fields.currentPin,security);
      }
      const salt = randomBytes(16);
      const hash = await derive(fields.newPin, salt, 210_000, 32, 'sha256');
      const updatedAt = now();
      await db.prepare(`INSERT INTO user_security(user_id,pin_hash,pin_salt,updated_at) VALUES(?,?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET pin_hash=excluded.pin_hash,pin_salt=excluded.pin_salt,
        failed_attempts=0,locked_until=NULL,updated_at=excluded.updated_at`).bind(user.id,hash.toString('base64'),salt.toString('base64'),updatedAt).run();
      return { configured:true, updatedAt };
    });
  }

  const getOrder = (db,id) => db.prepare('SELECT * FROM esim_purchase_orders WHERE id=?').bind(id).first();
  function present(row) {
    const adminView = { account:row.user_email, name:row.user_name };
    const items = JSON.parse(row.lines).map(({ id, name, count, priceRaw }) => ({ id, name, count, priceRaw }));
    return { ...adminView, id:row.id, status:row.status === 'submitting' ? 'uncertain' : row.status,
      orderNo:row.order_no, amountRaw:row.amount, items, error:row.error, createdAt:row.created_at, retryAfter: new Date(Date.parse(row.updated_at)+30_000).toISOString() };
  }
  const unresolved = (db,user) => db.prepare(`SELECT * FROM esim_purchase_orders
    WHERE user_id=? AND status IN ('submitting','uncertain') ORDER BY created_at DESC LIMIT 1`).bind(user.id).first();

  async function quote(db,user,ids) {
    const pending = await unresolved(db,user);
    if (pending) return { pending:{ ...present(pending), canRetry:true } };
    const [catalog, rawBalance, security] = await Promise.all([supplier.catalog(), supplier.balance(),readSecurity(db,user)]);
    return {
      lines:(await packageLines(db,user,onlyIds(ids),catalog)).map(({ id, name, priceRaw, periodNum }) => ({ id,name,priceRaw,periodNum })),
      availableRaw:await availability(db,user,rawBalance), pinConfigured:Boolean(security),
      maxCards:maximumCards, currency:'USD',
    };
  }

  async function recordAccepted(db,row,orderNo) {
    const changes = [];
    if (row.staff) {
      const left = await balanceFor(db,row.user_id) - row.amount;
      changes.push(db.prepare(`INSERT INTO quota_transactions(id,user_id,platform,kind,amount,balance_after,reference,note,created_at)
        VALUES(?,?,?,?,?,?,?,?,?)`).bind(row.id,row.user_id,supplierName,'购买',-row.amount,left,orderNo,'eSIMAccess 实际下单',now()));
    }
    changes.push(db.prepare(`UPDATE esim_purchase_orders SET status='allocating',order_no=?,error=NULL,updated_at=? WHERE id=?`)
      .bind(orderNo,now(),row.id));
    await db.batch(changes);
  }

  async function submit(db,user,fields) {
    const { id, items, pin } = orderInput(fields);
    return serialize(async () => {
      const existing = await getOrder(db,id);
      if (existing) {
        check(existing.user_id === user.id, 404, '订单未找到。');
        return present(existing);
      }
      check(!await unresolved(db,user),409,'有一笔订单正在核对，请先查看购买记录。');
      await verifyPaymentPin(db,user,pin,await readSecurity(db,user));
      const [catalog, balance] = await Promise.all([supplier.catalog(), supplier.balance()]);
      const lines = (await packageLines(db,user,items.map(item => item.id),catalog)).map((line,index) => {
        const { priceRaw, count } = items[index];
        check(line.priceRaw === priceRaw,409,'供应商价格已变动，请重新获取报价。');
        return { ...line,count };
      });
      const amount = lines.reduce((sum,line) => sum+line.priceRaw*line.count,0);
      check(Number.isSafeInteger(amount) && amount <= await availability(db,user,balance),402,
        isAdmin(user) ? 'eSIMAccess 可用余额不足，请核对主账号余额及已分配额度。' : '可用额度不足，请联系管理员。');
      const timestamp = now();
      await db.prepare(`INSERT INTO esim_purchase_orders(id,user_id,user_email,user_name,status,staff,amount,lines,created_at,updated_at)
        VALUES(?,?,?,?,'submitting',?,?,?,?,?)`).bind(id,user.id,user.email,user.name || user.email,isAdmin(user)?0:1,amount,JSON.stringify(lines),timestamp,timestamp).run();
      return sendOrder(db,await getOrder(db,id));
    });
  }

  async function sendOrder(db,row,retry=false) {
    let orderNo;
    try {
      orderNo = await supplier.order(row.id,JSON.parse(row.lines),row.amount);
    } catch (error) {
      const rejection = !retry && error instanceof SupplierError && Object.hasOwn(definiteFailures,error.code) ? definiteFailures[error.code] : null;
      await db.prepare('UPDATE esim_purchase_orders SET status=?,error=?,updated_at=? WHERE id=?')
        .bind(rejection?'rejected':'uncertain',rejection,now(),row.id).run();
      return present(await getOrder(db,row.id));
    }
    await recordAccepted(db,row,orderNo);
    return present(await getOrder(db,row.id));
  }

  async function retryOrder(db,user,fields) {
    check(typeof fields.id === 'string' && validRequestId.test(fields.id) && validPin(fields.pin),400,'请填写 6 位支付密码。');
    return serialize(async () => {
      const row = await getOrder(db,fields.id);
      check(row?.user_id === user.id,404,'订单未找到。');
      if (!['submitting','uncertain'].includes(row.status)) return present(row);
      check(Date.now() - Date.parse(row.updated_at) >= 30_000,429,'请等待 30 秒后再尝试核对该单。');
      await verifyPaymentPin(db,user,fields.pin,await readSecurity(db,user));
      const lines = JSON.parse(row.lines);
      const current = await packageLines(db,user,lines.map(line=>line.id),await supplier.catalog());
      check(current.every((line,index)=>line.code===lines[index].code && line.priceRaw===lines[index].priceRaw &&
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

  async function quotaOverview(db) {
    const [balance, total] = await Promise.all([supplier.balance(),allocated(db)]);
    const employees = identities.list().filter(account => !isAdmin(account) && account.enabled !== false);
    const accounts = await Promise.all(employees.map(async account => ({
      email:account.email, name:account.name, availableRaw:await balanceFor(db,account.id),
    })));
    return { accounts, balanceRaw:balance, allocatedRaw:total, unallocatedRaw:Math.max(0,balance-total-await reserved(db,'staff=0')) };
  }
  async function assignQuota(db, fields) {
    const { email,target,expectedRaw } = quotaInput(fields);
    return serialize(async () => {
      const account = identities.list().find(account => account.email.toLowerCase() === email && account.enabled !== false && !isAdmin(account));
      check(account,404,'未找到该员工账号。');
      const current = await balanceFor(db,account.id);
      check(current === expectedRaw,409,'员工额度已变动，请重新打开此窗口。');
      const difference = target-current;
      if (!difference) return { availableRaw:target };
      check(target >= await reserved(db,'user_id=?',account.id),409,'该员工有一笔正在核对的订单，无法收回这部分额度。');
      if (difference > 0) {
        const available = await supplier.balance() - await allocated(db) - await reserved(db,'staff=0');
        check(difference <= available,402,'分配金额超过 eSIMAccess 可分配余额。');
      }
      await db.prepare(`INSERT INTO quota_transactions(id,user_id,platform,kind,amount,balance_after,note,created_at)
        VALUES(?,?,?,?,?,?,?,?)`).bind(randomUUID(),account.id,supplierName,difference>0?'分配额度':'收回额度',difference,target,'管理员调整 eSIMAccess 额度',now()).run();
      return { availableRaw:target };
    });
  }

  const renewals = createEsimRenewals({ supplier,dbReady,serialize,isAdmin,availability,balanceFor,check,readSecurity,verifyPaymentPin,
    validPin,definiteFailures,supplierName });
  const renewalPaths = new Set(['/api/esim/renewal-quote','/api/esim/renewals']);
  const paths = new Set(['/api/esim/purchase-quote','/api/esim/purchases','/api/esim/purchase-quota',...renewalPaths]);
  async function route(req,res,url,user) {
    const security = url.pathname === '/api/settings/security' && req.method === 'POST';
    if (!security && !paths.has(url.pathname)) return false;
    const respond = (status,body) => {
      res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store'});
      res.end(JSON.stringify(body));
      return true;
    };
    try {
      const quota = url.pathname === '/api/esim/purchase-quota';
      const renewal = renewalPaths.has(url.pathname);
      if (quota) check(isAdmin(user),403,'仅管理员可以分配额度。');
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
        if (security) return respond(200,await updateSecurity(db,user,fields));
        if (quota) return respond(200,await assignQuota(db,fields));
        if (url.pathname.endsWith('purchase-quote')) return respond(200,await quote(db,user,onlyIds(fields?.ids)));
        const order = fields?.retry === true ? await retryOrder(db,user,fields) : await submit(db,user,fields);
        return respond(order.status === 'rejected' ? 409 : order.status === 'ready' ? 200 : 202,{ order:{ ...order, canRetry:true } });
      }
      if (req.method === 'GET' && url.pathname.endsWith('/renewals')) return respond(200,await renewals.history(user,url.searchParams));
      if (req.method === 'GET' && quota) return respond(200,await quotaOverview(await dbReady()));
      if (req.method === 'GET' && url.pathname.endsWith('/purchases')) {
        const db = await dbReady();
        const id = url.searchParams.get('id');
        if (id) {
          check(validRequestId.test(id),404,'订单未找到。');
          let row = await getOrder(db,id);
          check(row && (isAdmin(user) || row.user_id === user.id),404,'订单未找到。');
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
      if (error instanceof PurchaseError) return respond(error.status,{ error:error.message });
      if (renewalPaths.has(url.pathname)) {
        console.warn('eSIM renewal request unavailable');
        return respond(503,{error:'续费服务暂时不可用。已提交的请求请到续费记录中核对。'});
      }
      if (!security) console.warn('eSIM purchase request unavailable');
      return respond(503,{ error:security ? '支付密码服务暂时不可用。' : '购买服务暂时不可用。如已确认支付，请打开购买记录核对。' });
    }
  }
  async function summary(user) {
    const db = await dbReady();
    return isAdmin(user) ? { allocatedRaw:await allocated(db) } : { availableRaw:Math.max(0, await balanceFor(db,user.id) - await reserved(db,'user_id=?',user.id)) };
  }
  return { route, summary, sync, reconcile, ready:dbReady };
}
