import https from 'node:https';
import { DatabaseSync } from 'node:sqlite';
import { createArchiveDownloads } from './commerce/archive-downloads.mjs';
import { createWallet, migrateQuotas } from './commerce/wallet.mjs';
import { createDeposits } from './commerce/deposits.mjs';
import { createCommerce, loadUsdtConfig } from './commerce/commerce.mjs';
import { serveLocaleAsset, withLocale } from './commerce/locale-html.mjs';
import path from 'node:path';
import { readFileSync, statSync, createReadStream } from 'node:fs';
import { openIdentityStore } from './resource-operations/session-store.mjs';
import { makeResourceOperations } from './resource-operations/resource-operations.mjs';
import { createEsimPurchases } from './resource-operations/esim-purchases.mjs';
import { createEsimCatalog } from './resource-operations/esim-catalog.mjs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { worker } from './runtime.mjs';
import { createOutlookMail } from './outlook-mail.mjs';
import { trustedHeaders, verifyPassword, safeReturn } from './auth.mjs';
import { login, registrationPage } from './public-auth.mjs';
import { clientAddress, customerEsimRoute, isBrandedTemplatePreview, customerWorkbenchRoute, reservedPublicEmail } from './registration.mjs';
import { viewerFor } from './resource-operations/account-access.mjs';
import { callbackAuthorized } from './site-order-queue.mjs';
import { handlePrivateTemplateArchive, enhanceArchiveHtml } from './private-template-archive.mjs';

const root = process.cwd();
const config = JSON.parse(readFileSync('config/runtime.json', 'utf8'));
const outlook = createOutlookMail(root, config);
const mf = worker(root, config, outlook);
await mf.ready;
const attempts = new Map();
const identities = openIdentityStore(root, { config, outlook });
const commerceDb = new DatabaseSync(path.join(root,'data','commerce.sqlite'));
const wallet = createWallet(commerceDb);
const archiveDownloads = createArchiveDownloads({ db:commerceDb, wallet });
const deposits = createDeposits({db:commerceDb,config:loadUsdtConfig(root,config),credit:wallet.credit});
const purchases = createEsimPurchases({ config, mf, identities, wallet, readBody: body });
const catalog = createEsimCatalog(config.bindings || {}, { usesSupplier: purchases.usesSupplier });
void catalog.warm();
const commerceD1 = await purchases.ready();
await migrateQuotas(commerceD1,wallet);
const commerce = createCommerce({wallet,db:commerceDb,mf,config,identities,deposits,readBody:body,purchases,outlook});
deposits.start();
let maintaining = false;
async function reconcileCommerce() {
  if (maintaining) return;
  maintaining = true;
  try { archiveDownloads.expire(); await Promise.all([migrateQuotas(commerceD1,wallet),commerce.sync(),purchases.settle()]); }
  catch { console.warn('Commerce reconciliation delayed'); }
  finally { maintaining = false; }
}
void reconcileCommerce();
const commerceTimer=setInterval(reconcileCommerce,30_000);
const operations = makeResourceOperations({ root, config, mf, identities, readBody: body, outlook, purchases, wallet });
function returnPath(value) {
  const clean = safeReturn(value);
  const permitted = /^\/__host\/(?:accounts|wallet|shop|support|refund-review|payment-review|template-archive\/?)(?:\?|$)/;
  if (clean === '/' && typeof value === 'string' && permitted.test(value) && !/[\\\r\n]/.test(value)) {
    return value;
  }
  return clean;
}
function customerDestination(url) {
  if (url.pathname === '/__host/shop') {
    const params = url.searchParams;
    if (params.get('section') !== 'wallet') return '/';
    return '/?section=wallet' + (params.get('action') === 'recharge' ? '&action=recharge' : '');
  }
  const pages = new Set(['/','/__host/support','/__host/wallet','/__host/template-archive','/__host/template-archive/','/mail-delivery']);
  const orderPage = url.pathname.startsWith('/address-orders/') && customerWorkbenchRoute('GET',url.pathname);
  return pages.has(url.pathname) || orderPage ? url.pathname + url.search : '/';
}
const cookie = '__Host-lumen_session';
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const redirect = (res, location, headers = {}) => { res.writeHead(303, { location, 'cache-control': 'no-store', ...headers }); res.end(); };
async function body(req, limit = 16384) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new Error('Request too large'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
const tls = config.tlsPfxPassword
  ? { pfx: readFileSync('config/tls.pfx'), passphrase: config.tlsPfxPassword }
  : { key: readFileSync('config/tls.key'), cert: readFileSync('config/tls.crt') };
const server = https.createServer(tls, async (req, res) => {
  try {
    const origin = config.origin;
    const url = new URL(req.url, origin);
    const allowedOrigins = new Set([origin, ...(config.aliasOrigins || [])]);
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers.origin && !allowedOrigins.has(req.headers.origin)) return json(res, 403, { error: '请求来源不匹配' });
    if (serveLocaleAsset(req,res,url.pathname)) return;
    if (url.pathname === '/__host/health') return json(res, 200, { ok: true, sourceVersion: 29, commerceVersion: '1.9.1' });
    // Machine callbacks use the existing order secret, never a browser session.
    if (url.pathname === '/api/address-orders/callback') {
      if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
      if (!callbackAuthorized(req.headers.authorization, config.bindings?.ADDRESS_ORDER_CALLBACK_TOKEN)) return json(res, 401, { error: '未授权' });
      const payload = await body(req, 8192);
      const response = await mf.dispatchFetch(url.href, { method: 'POST', headers: { authorization: req.headers.authorization, 'content-type': 'application/json' }, body: payload });
      if (response.ok) {
        try {
          const update = JSON.parse(payload.toString());
          if (update.status === 'failed') await commerce.reviewFailure(update.requestNo);
        } catch { console.warn('Address refund review deferred to reconciliation'); }
      }
      res.writeHead(response.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(await response.text());
      return;
    }
    if (url.pathname === '/signin-with-chatgpt') return redirect(res, '/__host/login?returnTo=' + encodeURIComponent(safeReturn(url.searchParams.get('return_to'))));
    const authForm = /^\/__host\/(register|forgot)(?:\/(code|verify))?$/.exec(url.pathname);
    if (authForm) {
      const reset = authForm[1] === 'forgot';
      const step = authForm[2];
      if (!step && req.method === 'GET') return registrationPage(res, { reset });
      if (!step || req.method !== 'POST') return json(res, 405, { error: '请求方式不支持。' });
      if (!allowedOrigins.has(req.headers.origin) || !/^application\/x-www-form-urlencoded\b/i.test(req.headers['content-type'] || '')) {
        return json(res, 403, { error: '请在本站账号页面提交。' });
      }
      const fields = new URLSearchParams((await body(req,4096)).toString());
      const email = fields.get('email') || '';
      const auth = identities.registration;
      if (step === 'code') {
        const send = reset ? auth.requestResetCode : auth.requestCode;
        const result = await send(email, clientAddress(req));
        return registrationPage(res, { ...result, email, reset, verify: result.status === 200 || result.status === 429 });
      }
      const verify = reset ? auth.resetPassword : auth.register;
      const result = verify({ email, code: fields.get('code'), password: fields.get('password') });
      if (result.reset) return redirect(res, '/__host/login?reset=complete', { 'set-cookie': identities.cookie('') });
      if (result.account) return redirect(res, '/', { 'set-cookie': identities.issue(result.account) });
      return registrationPage(res, { ...result, email, reset, verify: true });
    }
    if (url.pathname === '/__host/login') {
      if (req.method === 'GET') return login(res, returnPath(url.searchParams.get('returnTo')), '', url.searchParams.get('reset') === 'complete');
      if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
      const address = clientAddress(req);
      let attempt = attempts.get(address);
      if (!attempt || attempt.until <= Date.now()) attempt = { count: 0, until: Date.now() + 15 * 60_000 };
      if (attempt.count >= 8) return json(res, 429, { error: '登录尝试过多，请稍后重试' });
      const fields = new URLSearchParams((await body(req)).toString());
      const user = identities.byEmail((fields.get('email') || '').trim().toLowerCase());
      if (!user || user.enabled === false || !verifyPassword(fields.get('password') || '', user.password)) {
        attempt.count++; attempts.set(address, attempt); return login(res, returnPath(fields.get('returnTo')), '账号或密码不正确');
      }
      attempts.delete(address);
      const destination = returnPath(fields.get('returnTo'));
      return redirect(res, user.role === 'customer' ? customerDestination(new URL(destination, origin)) : destination, { 'set-cookie': identities.issue(user) });
    }
    const token = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(cookie + '='))?.slice(cookie.length + 1);
    if (url.pathname === '/signout-with-chatgpt') { identities.remove(token); return redirect(res, '/__host/login', { 'set-cookie': identities.cookie('') }); }
    const session = identities.lookup(token);
    if (!session) {
      if (url.pathname.startsWith('/api/')) return json(res, 401, { error: '请先登录' });
      return redirect(res, '/__host/login?returnTo=' + encodeURIComponent(returnPath(url.pathname + url.search)));
    }
    if (session.user.role === 'customer' && reservedPublicEmail(config, session.user.email)) {
      identities.remove(token);
      return json(res, 403, { error: '账号权限已变更，请联系管理员。' });
    }
    if (session.refreshCookie) res.setHeader('set-cookie', session.refreshCookie);
    const user = session.user;
    const customer = user.role === 'customer';
    if (customer && req.method === 'GET' && url.pathname === '/__host/shop') return redirect(res, customerDestination(url));
    if (url.pathname === '/api/settings/security') return json(res,410,{error:'支付密码已停用。'});
    if (req.method === 'GET' && url.pathname === '/__host/security') return redirect(res, '/__host/wallet');
    if (await commerce.route(req,res,url,user)) return;
    if (await handlePrivateTemplateArchive(req, res, { root, url, user, allowedOrigins, config, archiveDownloads, readBody:body })) return;
    if (customer && !(customerEsimRoute(req.method, url.pathname) || customerWorkbenchRoute(req.method, url.pathname))) {
      return json(res, 403, { error: '此账号无权访问该资源。' });
    }
    if (req.method === 'GET' && url.pathname === '/api/session') {
      return json(res, 200, { authenticated: true, viewer: viewerFor(config,user) });
    }
    if (customer && req.method === 'GET' && url.pathname === '/api/addresses/normalize') {
      return json(res, 200, { configured: false, restricted: true });
    }
    if (req.method === 'GET' && (url.pathname === '/__host/esim-checkout.js' || url.pathname === '/__host/esim-checkout.css')) {
      const filename = url.pathname.endsWith('.css') ? 'esim-checkout.css' : 'esim-checkout.js';
      const type = filename.endsWith('.css') ? 'text/css' : 'application/javascript';
      res.writeHead(200, { 'content-type': type + '; charset=utf-8', 'cache-control': 'private, no-cache', 'x-content-type-options': 'nosniff' });
      return res.end(readFileSync(path.join(root, 'resource-operations', filename)));
    }
    if (await catalog.route(req, res, url, session.user)) return;
    if (await purchases.route(req, res, url, session.user)) return;
    if (await operations.route(req, res, url, session.user)) return;
    if (req.method === 'GET' || req.method === 'HEAD') {
      const assetRoot = path.join(root, 'dist', 'client');
      const asset = path.resolve(assetRoot, '.' + decodeURIComponent(url.pathname));
      if (asset.startsWith(assetRoot + path.sep)) {
        try {
          if (statSync(asset).isFile()) {
            const types = { '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json' };
            res.writeHead(200, { 'content-type': types[path.extname(asset)] || 'application/octet-stream', 'cache-control': url.pathname.includes('/assets/') ? 'private, max-age=31536000, immutable' : /\/(page|mail-delivery-center|address-order-status)-[^/]+\.js$/.test(url.pathname) ? 'private, no-cache' : 'private, max-age=3600' });
            if (req.method === 'HEAD') return res.end();
            await pipeline(createReadStream(asset), res); return;
          }
        } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error; }
      }
    }
    if (isBrandedTemplatePreview(url.pathname)) return json(res, 404, { error: '暂无样张' });
    const headers = trustedHeaders(req.headers, session.user);
    for (const name of [...headers.keys()]) if (name.startsWith('x-lumen-')) headers.delete(name);
    // The outer gateway checks the original browser origin before normalization.
    if (req.headers.origin) headers.set('origin', origin);
    const payload = req.method === 'GET' || req.method === 'HEAD' ? undefined : await body(req, 2 * 1024 * 1024);
    if (customer && url.pathname === '/api/resources/status') {
      let fields;
      try { fields=JSON.parse(payload.toString()); }
      catch { return json(res,400,{error:'资源状态参数不完整'}); }
      if (!['eSIMAccess', 'warehouse'].includes(fields?.supplier)) return json(res,403,{error:'此账号无权访问该资源。'});
    }
    const response = await mf.dispatchFetch(url.href, { method: req.method, headers, body: payload, redirect: 'manual' });
    res.statusCode = response.status;
    for (const [key, value] of response.headers) if (!['transfer-encoding', 'content-encoding', 'content-length'].includes(key)) res.setHeader(key, value);
    res.setHeader('x-content-type-options', 'nosniff');
    if (req.method === 'GET' && response.headers.get('content-type')?.includes('text/html')) res.removeHeader('content-length');
    if (req.method === 'GET' && url.pathname === '/' && response.headers.get('content-type')?.includes('text/html')) return res.end(withLocale(enhanceArchiveHtml(await response.text(), session.user).replace('</head>', '<link rel="stylesheet" href="/__host/esim-checkout.css"><link rel="stylesheet" href="/__host/dashboard.css"><link rel="stylesheet" href="/__host/market-table.css"><script defer src="/__host/esim-checkout.js"></script><script defer src="/__host/market-table.js"></script><script defer src="/__host/commerce-bridge.js"></script></head>').replace('</body>', '<script defer src="/__host/resource-operations.js"></script></body>')));
    const localizedPage = !url.pathname.startsWith('/api/');
    if (req.method === 'GET' && localizedPage && response.headers.get('content-type')?.includes('text/html')) {
      return res.end(withLocale(await response.text()));
    }
    if (response.body && req.method !== 'HEAD') await pipeline(Readable.fromWeb(response.body), res); else res.end();
  } catch {
    if (!res.headersSent) json(res, 500, { error: '服务暂时不可用，请稍后重试' }); else res.end();
    console.error(JSON.stringify({ event: 'request_failed', path: req.url?.split('?')[0], time: new Date().toISOString() }));
  }
});
server.listen(config.port || 8443, process.env.LUMEN_LISTEN_HOST || '0.0.0.0', () => console.log(JSON.stringify({ event: 'listening', sourceVersion: 29, commerceVersion: '1.9.1', port: config.port || 8443 })));
const cleanup = setInterval(() => { identities.cleanup(); for (const [key, value] of attempts) if (value.until < Date.now()) attempts.delete(key); }, 60_000);
for (const event of ['SIGTERM', 'SIGINT']) process.on(event, () => { clearInterval(cleanup); clearInterval(commerceTimer); deposits.stop(); operations.close(); server.close(async () => { await mf.dispose(); process.exit(0); }); });
