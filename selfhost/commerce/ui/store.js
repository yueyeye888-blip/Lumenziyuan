'use strict';
const $ = (id) => document.getElementById(id);
const elem = (tag, text, cls) => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  return n;
};
const button = (text, action) => {
  const b = elem('button', text, 'secondary');
  b.type = 'button';
  b.onclick = () => run(b, action);
  return b;
};
const money = (raw) =>
  Number(raw / 10000).toLocaleString('en-US', { maximumFractionDigits: 4, useGrouping: false }) + ' U';
const statusText = {
  pending: '等待支付',
  confirming: '链上确认中',
  credited: '已入账',
  expired: '已过期',
  review: '待人工核对',
  uncertain: '订单确认中',
  allocating: '正在分配',
  ready: '可查看',
  rejected: '已拒绝',
  succeeded: '已续费',
  queued: '已提交',
  delivered: '已交付',
  failed: '处理失败',
  filling: '资料处理中',
  payment_pending: '等待处理',
  generating: '生成中',
  payment_confirmed: '等待交付',
};
const date = (s) => new Date(s).toLocaleString('zh-CN', { hour12: false });
function message(text, error = false) {
  $('notice').textContent = text;
  $('notice').classList.toggle('problem', error);
  if (error) $('notice').scrollIntoView({ block: 'nearest' });
}
async function run(control, action) {
  control.disabled = true;
  try {
    await action();
  } catch (e) {
    message(e.message, true);
  } finally {
    control.disabled = false;
  }
}
function form(id, fn) {
  $(id).onsubmit = (e) => {
    e.preventDefault();
    run(e.submitter || $(id).querySelector('button'), () =>
      fn(Object.fromEntries(new FormData(e.target)), e.target),
    );
  };
}
async function api(path, data, headers = {}) {
  const r = await fetch(path, {
    method: data ? 'POST' : 'GET',
    cache: 'no-store',
    headers: { ...(data ? { 'content-type': 'application/json' } : {}), ...headers },
    body: data ? JSON.stringify(data) : undefined,
  });
  if (r.status === 401) {
    location.assign('/__host/login');
    throw Error('请重新登录。');
  }
  let j;
  try {
    j = await r.json();
  } catch {
    throw Error('服务暂时未返回结果，请稍后核对记录。');
  }
  if (!r.ok) {
    const e = Error(j.error || j.order?.error || '请求未完成，请核对记录。');
    e.order = j.order;
    e.status = r.status;
    throw e;
  }
  return j;
}
function row(parent, title, detail, action) {
  const line = elem('div', undefined, 'row'),
    info = elem('div');
  info.append(elem('strong', title));
  if (detail) info.append(elem('small', detail));
  line.append(info);
  if (action) line.append(action);
  parent.append(line);
  return info;
}
function empty(n, text) {
  if (!n.childElementCount) n.append(elem('p', text, 'hint'));
}
function inputField(label, name, opts = {}) {
  const l = elem('label', label),
    i = document.createElement(opts.options ? 'select' : 'input');
  i.name = name;
  if (opts.options) {
    for (const [value, label] of opts.options) i.add(new Option(label, value));
  } else Object.assign(i, opts);
  l.append(i);
  return l;
}
function ask(title, fields) {
  const d = $('dialog');
  $('dialog-title').textContent = title;
  $('dialog-fields').replaceChildren(...fields);
  d.returnValue = '';
  return new Promise((resolve) => {
    d.onclose = () =>
      resolve(d.returnValue === 'ok' ? Object.fromEntries(new FormData(d.querySelector('form'))) : null);
    d.showModal();
  });
}
const pinField = () =>
  inputField('六位支付密码', 'pin', {
    type: 'password',
    required: true,
    inputMode: 'numeric',
    pattern: '[0-9]{6}',
    maxLength: 6,
    autocomplete: 'off',
  });
function keyFor(name) {
  let k = sessionStorage.getItem('lumen:' + name);
  if (!k) {
    k = crypto.randomUUID();
    sessionStorage.setItem('lumen:' + name, k);
  }
  return k;
}
function clearKey(name) {
  sessionStorage.removeItem('lumen:' + name);
}
let wallet,
  invoiceId,
  invoiceExpiry,
  offset = 0,
  hasNext = false,
  templates = [];
const invoiceLabels = (o) => [
  statusText[o.status] || o.status,
  o.network + ' · 应付 ' + o.expectedAmount + ' USDT · 入账 ' + o.amount + ' U',
];
async function loadWallet() {
  wallet = await api('/api/commerce/wallet');
  $('account').textContent = wallet.email;
  $('workspace').hidden = wallet.role === 'customer';
  $('balance').textContent = money(wallet.availableRaw).replace(' U', '');
  $('held').textContent = '订单预留 ' + money(wallet.heldRaw);
  const select = $('deposit-form').elements.network,
    sel = select.value;
  select.replaceChildren();
  for (const n of wallet.networks) {
    const o = new Option(n.label + (n.enabled ? '' : '（暂不可用）'), n.id);
    o.disabled = !n.enabled;
    select.add(o);
  }
  select.value =
    wallet.networks.find((n) => n.id === sel && n.enabled)?.id || wallet.networks.find((n) => n.enabled)?.id || '';
  $('deposit-form').querySelector('button').disabled = !select.value;
  const ledger = $('entries');
  ledger.replaceChildren();
  for (const e of wallet.entries)
    row(ledger, (e.delta > 0 ? '+' : '') + money(e.delta), e.note + ' · ' + date(e.createdAt));
  empty(ledger, '暂无余额变动');
  $('admin').hidden = wallet.role !== 'admin';
  const target = new URL(location.href).searchParams.get('credit');
  if (wallet.role === 'admin' && target && !$('credit-form').dataset.initialized) {
    $('credit-form').elements.email.value = target;
    $('credit-form').dataset.initialized = 'true';
    $('admin').scrollIntoView({block:'start'});
  }
}
async function loadDeposits() {
  const { orders } = await api('/api/commerce/deposits'),
    n = $('deposits');
  n.replaceChildren();
  for (const o of orders) {
    const [s, info] = invoiceLabels(o);
    row(
      n,
      s,
      info + ' · ' + date(o.createdAt),
      button('查看', () => openInvoice(o.id, true)),
    );
  }
  empty(n, '暂无充值记录');
  return orders;
}
function countdown() {
  if (!invoiceExpiry || !$('countdown')) return;
  const diff = Math.max(0, Math.ceil((Date.parse(invoiceExpiry) - Date.now()) / 1000));
  $('countdown').textContent = diff
    ? '剩余 ' + Math.floor(diff / 60) + ' 分 ' + String(diff % 60).padStart(2, '0') + ' 秒'
    : '付款时间已结束，请等待链上核对';
}
function displayInvoice(o) {
  $('invoice').hidden = false;
  invoiceId = o.id;
  invoiceExpiry = o.expiresAt;
  const n = $('invoice-data');
  n.replaceChildren();
  const [s] = invoiceLabels(o);
  n.append(
    elem('p', o.network + ' · ' + s),
    elem('strong', (o.status === 'credited' ? '已入账 ' : '入账余额 ') + (o.creditedAmount ?? o.amount) + ' U'),
  );
  if (o.status === 'pending' && Date.parse(o.expiresAt) > Date.now()) {
    n.append(elem('p', '应付 ' + o.expectedAmount + ' USDT', 'amount'));
    const timer = elem('p', '', 'timer');
    timer.id = 'countdown';
    n.append(timer);
    countdown();
    const img = new Image();
    img.className = 'qr';
    img.alt = '收款地址二维码';
    img.src = '/api/commerce/deposit?id=' + encodeURIComponent(o.id) + '&qr=1';
    const addr = elem('code', o.address);
    n.append(
      img,
      addr,
      elem('div'),
      button('复制地址', async () => {
        await navigator.clipboard.writeText(o.address);
        message('收款地址已复制。');
      }),
      button('复制应付金额', async () => {
        await navigator.clipboard.writeText(o.expectedAmount);
        message('应付金额已复制。');
      }),
    );
    n.append(
      elem(
        'p',
        '请在所选网络转入完整应付金额，手续费另付。小数尾数用于识别订单，最多 0.09 USDT，尾数不计入余额。',
        'hint',
      ),
    );
  } else
    n.append(
      elem(
        'p',
        '订单应付 ' + o.expectedAmount + ' USDT' + (o.paidAmount ? ' · 已检测 ' + o.paidAmount + ' USDT' : ''),
      ),
    );
  if (o.txHash) n.append(elem('p', '交易哈希'), elem('code', o.txHash));
  n.dataset.state = o.status;
}
async function openInvoice(id, scroll = false) {
  const { order } = await api('/api/commerce/deposit?id=' + encodeURIComponent(id));
  const old = $('invoice-data').dataset.state;
  displayInvoice(order);
  if (scroll) $('invoice').scrollIntoView({ block: 'center' });
  if (old && old !== order.status) await Promise.all([loadWallet(), loadDeposits()]);
}
form('deposit-form', async (f) => {
  const key = 'deposit:' + f.network + ':' + f.amount;
  const { order } = await api('/api/commerce/deposits', { ...f, requestId: keyFor(key) });
  clearKey(key);
  displayInvoice(order);
  await loadDeposits();
  $('invoice').scrollIntoView({ block: 'center' });
});
form('pin-form', async (f, el) => {
  await api('/api/settings/security', f);
  el.reset();
  message('支付密码已更新。');
});
form('credit-form', async (f, el) => {
  const ok = await ask('给 ' + f.email + ' 添加 ' + f.amount + ' U', [elem('p', '备注：' + f.note)]);
  if (!ok) return;
  const k = 'credit:' + f.email + ':' + f.amount + ':' + f.note;
  const r = await api('/api/commerce/admin/credit', { ...f, requestId: keyFor(k) });
  clearKey(k);
  el.reset();
  await loadWallet();
  message(r.email + ' 当前可用余额 ' + money(r.availableRaw));
});
async function admin() {
  const r = await api('/api/commerce/admin/deposits');
  $('health').textContent = r.health
    .map((x) => x.label + ' · ' + (x.error || (x.enabled ? '已配置' : '未启用')))
    .join('　');
  const n = $('reviews');
  n.replaceChildren();
  for (const item of r.reviews) {
    row(
      n,
      item.network + ' · ' + item.paidAmount + ' USDT',
      item.txHash + ' · ' + item.reason,
      button('核对', async () => {
        const data = await ask('处理已确认的异常转账', [
          elem('p', item.network + ' · ' + item.paidAmount + ' USDT'),
          inputField('处理方式', 'action', {
            options: [
              ['acknowledge', '记录处理结果'],
              ['credit', '人工匹配入账'],
            ],
          }),
          inputField('入账账号邮箱', 'email', { type: 'email' }),
          inputField('入账整数 U', 'principal', { type: 'number', min: '1', step: '1' }),
          inputField('关联充值单编号（如有）', 'orderId', {}),
          inputField('核对备注', 'note', { required: true, maxLength: 180 }),
        ]);
        if (!data) return;
        await api('/api/commerce/admin/review', {
          ...data,
          network: item.network,
          txHash: item.txHash,
          logIndex: item.logIndex,
        });
        await admin();
        message('处理结果已记录。');
      }),
    );
  }
  empty(n, '暂无待核对转账');
}
let catalogTicket = 0;
async function catalog() {
  const ticket = ++catalogTicket,
    q = $('search').elements.q.value;
  const r = await api('/api/esim/packages?' + new URLSearchParams({ q, offset, limit: 15 }));
  if (ticket !== catalogTicket) return;
  const n = $('products');
  n.replaceChildren();
  for (const p of r.items) {
    const operators = (p.operators || [])
      .map((x) => x.name)
      .filter(Boolean)
      .slice(0, 4)
      .join('、');
    row(
      n,
      p.name,
      [p.countryName, operators, money(p.priceRaw)].filter(Boolean).join(' · '),
      button('购买', () => buy(p)),
    );
  }
  empty(n, '没有找到套餐。');
  hasNext = r.hasMore;
  $('prev').disabled = !offset;
  $('next').disabled = !hasNext;
}
form('search', async () => {
  offset = 0;
  await catalog();
});
$('prev').onclick = () =>
  run($('prev'), async () => {
    offset = Math.max(0, offset - 15);
    await catalog();
  });
$('next').onclick = () =>
  run($('next'), async () => {
    if (hasNext) {
      offset += 15;
      await catalog();
    }
  });
async function buy(p) {
  const q = await api('/api/esim/purchase-quote', { ids: [p.id] });
  if (q.pending) throw Error('你有一笔订单正在核对，请查看我的订单。');
  if (!q.pinConfigured) throw Error('请先到「我的钱包」设置六位支付密码。');
  const line = q.lines[0];
  const count = inputField('数量', 'count', {
    type: 'number',
    value: '1',
    min: '1',
    max: String(q.maxCards || 30),
    required: true,
  });
  const total = elem('strong', '订单合计 ' + money(line.priceRaw));
  count.oninput = () => {
    total.textContent = '订单合计 ' + money(Number(count.firstElementChild.value) * line.priceRaw);
  };
  const f = await ask(line.name, [
    elem('p', '每张 ' + money(line.priceRaw) + ' · 可用 ' + money(q.availableRaw)),
    count,
    total,
    pinField(),
  ]);
  if (!f) return;
  const k = 'esim:' + p.id + ':' + f.count;
  let r;
  try {
    r = await api('/api/esim/purchases', {
      id: 'LH-' + keyFor(k),
      pin: f.pin,
      items: [{ id: p.id, count: Number(f.count), priceRaw: line.priceRaw }],
    });
  } catch (e) {
    if (e.order?.status === 'rejected') clearKey(k);
    throw e;
  }
  clearKey(k);
  message('订单已提交：' + r.order.id);
  await Promise.all([loadOrders(), loadWallet()]);
}
async function ordersDetail(o) {
  const r = await api('/api/esim/purchase-cards?id=' + encodeURIComponent(o.id));
  const n = $('order-details');
  n.replaceChildren(elem('h3', o.id));
  for (const c of r.cards) {
    const info = row(
      n,
      c.name || 'eSIM',
      [c.iccid || '', c.expiresAt ? '到期 ' + date(c.expiresAt) : ''].filter(Boolean).join(' · '),
      button('续费', () => renew(c)),
    );
    if (c.activationCode) info.append(elem('code', c.activationCode));
    if (c.qrCodeUrl) {
      try {
        const u = new URL(c.qrCodeUrl);
        if (u.protocol === 'https:') {
          const a = elem('a', '查看安装二维码');
          a.href = u.href;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          info.append(elem('br'), a);
        }
      } catch {}
    }
  }
  if (!r.cards.length) n.append(elem('p', '卡片正在分配，请稍后刷新。'));
}
async function renew(c) {
  const q = await api('/api/esim/renewal-quote', { ids: [c.resourceId] });
  const card = q.cards?.[0];
  if (!card?.options?.length) throw Error(card?.reason || '当前没有可续费方案。');
  const opts = card.options.map((x) => [x.code, x.name + ' · ' + money(x.priceRaw)]);
  const f = await ask('续费 · ' + c.name, [inputField('续费套餐', 'code', { options: opts }), pinField()]);
  if (!f) return;
  await api('/api/esim/renewals', { id: q.id, ...f });
  message('续费已提交，结果可在我的订单中查看。');
  await loadOrders();
}
async function loadOrders() {
  const [esim, addr, ren] = await Promise.all([
    api('/api/esim/purchases'),
    api('/api/commerce/address/orders'),
    api('/api/esim/renewals'),
  ]);
  const n = $('order-list');
  n.replaceChildren();
  function purchasesPage(data, start) {
    for (const o of data.orders)
      row(
        n,
        o.items.map((x) => x.name + ' × ' + x.count).join('、'),
        [money(o.amountRaw), statusText[o.status] || o.status, o.id, o.error].filter(Boolean).join(' · '),
        o.status === 'rejected' ? null : button('查看卡片', () => ordersDetail(o)),
      );
    if (data.hasMore) {
      const more = button('更多购买记录', async () => {
        const next = start + data.orders.length;
        const r = await api('/api/esim/purchases?offset=' + next);
        more.remove();
        purchasesPage(r, next);
      });
      n.append(more);
    }
  }
  function renewalsPage(data, start) {
    for (const o of data.records)
      row(
        n,
        '续费 · ' + o.plan,
        [money(o.amountRaw), statusText[o.status] || o.status, o.error].filter(Boolean).join(' · '),
      );
    if (data.hasMore) {
      const more = button('更多续费记录', async () => {
        const next = start + data.records.length;
        const r = await api('/api/esim/renewals?offset=' + next);
        more.remove();
        renewalsPage(r, next);
      });
      n.append(more);
    }
  }
  purchasesPage(esim, 0);
  renewalsPage(ren, 0);
  for (const o of addr.orders) row(n, o.name, (statusText[o.status] || o.status) + ' · ' + o.id);
  empty(n, '暂无订单');
}
$('refresh-orders').onclick = () => run($('refresh-orders'), loadOrders);
$('address-details').ontoggle = async () => {
  if (!$('address-details').open || templates.length) return;
  try {
    const r = await api('/api/commerce/address/templates');
    templates = r.items;
    const s = $('address-form').elements.template;
    s.add(new Option('请选择模板', ''));
    for (const x of templates)
      s.add(new Option([x.country, x.name, x.title].filter(Boolean).join(' · '), String(x.id)));
  } catch (e) {
    message(e.message, true);
  }
};
form('address-form', async (f, el) => {
  const t = templates.find((x) => String(x.id) === f.template);
  if (!t) throw Error('请选择模板。');
  const profile = { fullName: f.name, addressLines: [f.line1, f.line2, f.line3], recipientEmail: f.email };
  const k = 'address:' + (await digest(JSON.stringify([t.id, profile])));
  let r;
  try {
    r = await api(
      '/api/personal-details/submit',
      { profile, template: { id: t.id, name: t.name }, pin: f.pin },
      { 'idempotency-key': keyFor(k) },
    );
  } catch (e) {
    if (e.status >= 400 && e.status < 500) clearKey(k);
    throw e;
  }
  clearKey(k);
  el.reset();
  message('订单已提交：' + r.requestNo);
  await Promise.all([loadOrders(), loadWallet()]);
});
async function digest(t) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t))), (x) =>
    x.toString(16).padStart(2, '0'),
  ).join('');
}
(async () => {
  try {
    const shop = location.pathname.endsWith('/shop');
    $('title').textContent = shop ? '资源市场' : '我的钱包';
    document.title = $('title').textContent + ' · Lumen';
    $(shop ? 'shop' : 'wallet').hidden = false;
    for (const a of document.querySelectorAll('header nav a'))
      if (a.pathname === location.pathname) a.setAttribute('aria-current', 'page');
    await loadWallet();
    if (shop) {
      await Promise.all([catalog(), loadOrders()]);
    } else {
      const arr = await loadDeposits();
      const active = arr.find((o) => ['pending', 'confirming'].includes(o.status));
      if (active) displayInvoice(active);
      if (wallet.role === 'admin') await admin();
    }
  } catch (e) {
    message(e.message, true);
  }
})();
setInterval(countdown, 1000);
let polling = false;
setInterval(async () => {
  if (document.hidden || polling || !invoiceId || ['credited', 'review'].includes($('invoice-data').dataset.state))
    return;
  polling = true;
  try {
    await openInvoice(invoiceId);
  } catch (e) {
    message(e.message, true);
  } finally {
    polling = false;
  }
}, 10000);
