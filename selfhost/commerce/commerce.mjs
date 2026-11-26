import { createSupport } from './support.mjs';
import { withLocale } from './locale-html.mjs';
import { canManageAccounts } from '../resource-operations/account-access.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { qrcode } from './vendor/qrcode.mjs';
import { fault, amountRaw } from './wallet.mjs';
import { trustedHeaders } from '../auth.mjs';
import { createAddressBilling, addressPriceFor } from './address-billing.mjs';
import { createWarehouse } from './warehouse.mjs';

const uuid = /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const types = { css: 'text/css', js: 'application/javascript', html: 'text/html' };
const json = (res, code, value) => {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(value));
  return true;
};
const addressPost = '/api/personal-details/submit';
const assetDirectory = new URL('./ui/', import.meta.url);
export function loadUsdtConfig(root, config) {
  const file = join(root, 'config', 'usdt.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) : config.usdt || {};
}
export function createCommerce({ wallet, db, mf, config, identities, deposits, readBody, purchases, outlook }) {
  const admins = new Set(
    String(config.bindings?.RESOURCE_ADMIN_EMAILS || '')
      .toLowerCase()
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  );
  const admin = (u) => u.role !== 'customer' && admins.has(u.email.toLowerCase());
  const origins = new Set([config.origin, ...(config.aliasOrigins || [])]);
  const address = createAddressBilling({ db, mf, wallet, config });
  const support = createSupport({db,config,readBody,address});
  const warehouse = createWarehouse({
    wallet,
    db,
    mf,
    config,
    outlook,
  });
  async function route(req, res, url, user) {
    const path = url.pathname;
    if (await support.route(req,res,url,user)) return true;
    if (await warehouse.route(req, res, url, user)) return true;
    if (path === '/__host/payment-review' && !admin(user)) return json(res, 403, { error: '仅管理员可核对转账。' });
    const asset = {
      '/__host/shop': 'store.html',
      '/__host/wallet': 'store.html',
      '/__host/payment-review': 'store.html',
      '/__host/commerce.css': 'style.css',
      '/__host/commerce.js': 'store.js',
      '/__host/commerce-bridge.js': 'bridge.js',
      '/__host/dashboard.css': 'dashboard.css',
      '/__host/market-table.js': 'market-table.js',
      '/__host/market-table.css': 'market-table.css',
      '/__host/market-flags.css': 'market-flags.css',
    }[path];
    if (typeof asset === 'string') {
      if (req.method !== 'GET') return json(res, 405, { error: '请求方式不支持。' });
      const frameAncestors =
        path === '/__host/wallet' && url.searchParams.get('embedded') === '1' ? "'self'" : "'none'";
      res.writeHead(200, {
        'content-type': types[asset.split('.').pop()] + '; charset=utf-8',
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'same-origin',
        'content-security-policy':
          `default-src 'self'; img-src 'self' data: https:; script-src 'self'; style-src 'self'; frame-ancestors ${frameAncestors}; object-src 'none'; base-uri 'none'; form-action 'self'`,
      });
      const source = readFileSync(new URL(asset, assetDirectory));
      res.end(asset.endsWith('.html') ? withLocale(source) : source);
      return true;
    }
    if (path !== addressPost && !path.startsWith('/api/commerce/')) return false;
    try {
      if (
        req.method === 'POST' &&
        (!origins.has(req.headers.origin) || !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || ''))
      )
        throw fault(403, '请求来源不匹配。');
      const fields = async (limit = 4096) => {
        let raw;
        try {
          raw = await readBody(req, limit);
          const f = JSON.parse(raw);
          if (!f || typeof f !== 'object' || Array.isArray(f)) throw Error();
          return f;
        } catch {
          throw fault(400, '请求格式无效或内容过大。');
        }
      };
      if (path === '/api/commerce/wallet' && req.method === 'GET') {
        const usesSupplier = canManageAccounts(config,user);
        const supplier = usesSupplier ? await purchases.supplierBalance(user).catch(() => null) : null;
        return json(res, 200, {
          ...wallet.snapshot(user.id),
          email: user.email,
          role: admin(user) ? 'admin' : user.role === 'customer' ? 'customer' : 'employee',
          canManageAccounts: canManageAccounts(config,user),
          networks: deposits.networks(),
          priceAddressRaw: addressPriceFor(user),
          discountBps: user.discountBps ?? null,
          ...(usesSupplier && { esimSupplierBalanceRaw: supplier?.balanceRaw ?? null }),
        });
      }
      if (path === '/api/commerce/deposits' && req.method === 'GET')
        return json(res, 200, { orders: deposits.list(user.id) });
      if (path === '/api/commerce/deposits' && req.method === 'POST') {
        if (!admin(user) && user.role !== 'customer') throw fault(403, '合伙人账户额度由管理员添加。');
        const { network, amount, requestId } = await fields();
        if (!uuid.test(requestId || '')) throw fault(400, '请重新打开充值表单。');
        return json(res, 201, { order: await deposits.create({ userId: user.id, network, amount, requestId }) });
      }
      if (path === '/api/commerce/deposit' && req.method === 'GET') {
        const order = deposits.get(user.id, url.searchParams.get('id'));
        if (!order) throw fault(404, '未找到充值订单。');
        if (url.searchParams.get('qr') === '1') {
          const code = qrcode(0, 'M');
          code.addData(order.address);
          code.make();
          res.writeHead(200, {
            'content-type': 'image/svg+xml',
            'cache-control': 'private, no-store',
            'content-security-policy': "default-src 'none'",
          });
          res.end(code.createSvgTag({ cellSize: 4, margin: 16 }));
          return true;
        }
        return json(res, 200, { order });
      }
      if (path.startsWith('/api/commerce/admin/')) {
        if (!admin(user)) throw fault(403, '仅管理员可管理余额。');
        if (path === '/api/commerce/admin/credit' && req.method === 'POST') {
          if (!canManageAccounts(config,user)) throw fault(403,'仅超级管理员可增加账户额度。');
          const { email, amount, note, requestId } = await fields();
          if (!uuid.test(requestId || '') || typeof note !== 'string' || !note.trim() || note.length > 180)
            throw fault(400, '请填写入账备注。');
          const account = identities.byEmail(
            String(email || '')
              .trim()
              .toLowerCase(),
          );
          if (!account || account.enabled === false) throw fault(404, '账号未找到。');
          const added = wallet.credit({
            userId: account.id,
            amountRaw: amountRaw(amount),
            reference: 'admin:' + requestId,
            actor: user.id,
            note: '管理员加款 · ' + note.trim(),
          });
          return json(res, 200, { added, email: account.email, availableRaw: wallet.balance(account.id) });
        }
        if (path === '/api/commerce/admin/review' && req.method === 'POST') {
          const f = await fields();
          const account =
            f.action === 'credit'
              ? identities.byEmail(
                  String(f.email || '')
                    .trim()
                    .toLowerCase(),
                )
              : null;
          if (f.action === 'credit' && (!account || account.enabled === false))
            throw fault(404, '请填写已注册的入账邮箱。');
          if (f.action==='credit' && account.role!=='customer' && !canManageAccounts(config,user))
            throw fault(403,'合伙人额度请由超级管理员核对。');
          const resolution = deposits.resolve({
            network: f.network,
            txHash: f.txHash,
            logIndex: f.logIndex,
            action: f.action,
            userId: account?.id,
            principal: f.principal,
            orderId: f.orderId || undefined,
            actor: user.id,
            note: f.note,
          });
          return json(res, 200, { resolution });
        }
        if (path.endsWith('/deposits') && req.method === 'GET')
          return json(res, 200, { health: deposits.health(), reviews: deposits.reviews() });
      }
      if (path === '/api/commerce/address/price' && req.method === 'GET') {
        return json(res,200,{priceRaw:addressPriceFor(user)});
      }
      if (path === '/api/commerce/address/templates' && req.method === 'GET') {
        const r = await mf.dispatchFetch(new URL('/api/supplier-templates', config.origin).href, {
          headers: trustedHeaders({}, user),
        });
        if (!r.ok) throw fault(503, '暂时无法读取模板。');
        const catalog = await r.json();
        return json(res, 200, {
          items: catalog.items.map(({ id, name, title, country }) => ({ id, name, title, country })),
        });
      }
      if (path === '/api/commerce/address/orders' && req.method === 'GET') {
        const d1 = await mf.getD1Database('DB');
        const rows = await d1
          .prepare(
            'SELECT request_no AS id, template_name AS name, status, created_at AS createdAt FROM address_orders WHERE user_id=? ORDER BY created_at DESC LIMIT 100',
          )
          .bind(user.id)
          .all();
        return json(res, 200, { orders: rows.results });
      }
      if (path === addressPost && req.method === 'POST') {
        const data = await fields(8192);
        const reply = await address.submit(
          user,
          req.headers['idempotency-key'],
          Buffer.from(JSON.stringify({ template: data.template, profile: data.profile })),
          data.quotedPriceRaw,
        );
        return json(res, reply.status, reply.data);
      }
      return json(res, 404, { error: '接口不存在。' });
    } catch (error) {
      const status = Number(error.status || error.statusCode);
      if (status >= 400 && status < 600) return json(res, status, { error: error.message });
      console.warn('Commerce request unavailable', path);
      return json(res, 503, { error: '服务暂时不可用，请稍后核对账户记录。' });
    }
  }
  return {
    route,
    reviewFailure: address.reviewFailure,
    async sync() {
      void support.flushNotifications().catch(() => console.warn('Support notifications deferred'));
      await Promise.all([address.sync(), warehouse.recover?.()]);
    },
  };
}
