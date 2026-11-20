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
const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 });
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
const page = new URL(location.href);
const route = page.pathname.split('/').pop();
const view = route === 'shop' && page.searchParams.get('section') === 'wallet' ? 'wallet' : route;
const embedded = route === 'wallet' && page.searchParams.get('embedded') === '1';
const walletPage = route === 'shop' ? '/__host/shop?section=wallet' : '/__host/wallet';
const postToWorkspace = (type, detail = {}) => {
  if (embedded && parent !== window) parent.postMessage({ type, ...detail }, location.origin);
};
function showModal(dialog, control) {
  dialog.showModal();
  postToWorkspace('lumen:wallet-dialog-open');
  if (control) control.focus({ preventScroll: true });
}
function message(text, error = false) {
  const feedback = document.querySelector('dialog[open] .modal-feedback');
  if (feedback) {
    feedback.textContent = text;
    feedback.hidden = !text;
    feedback.classList.toggle('problem', error);
    return;
  }
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
    (embedded ? top : window).location.assign('/__host/login');
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
let historyOrders = [];
const networkName = (id) => wallet?.networks.find((network) => network.id === id)?.label ?? id;
function ledgerDate(value) {
  const t = new Date(value);
  if (!Number.isFinite(t.valueOf())) return '—';
  const node = elem('time', t.toLocaleDateString('zh-CN'));
  node.dateTime = t.toISOString();
  node.append(elem('small', t.toLocaleTimeString('zh-CN', { hour12: false })));
  return node;
}
function ledgerTable(container, headers, rows, placeholder) {
  container.replaceChildren();
  container.removeAttribute('aria-busy');
  if (!rows.length) {
    const state = elem('div', undefined, 'empty-state');
    const icon = elem('span', undefined, 'bill-icon');
    icon.setAttribute('aria-hidden', 'true');
    state.append(icon, elem('p', placeholder));
    container.append(state);
    return;
  }
  const table = elem('table', undefined, 'billing-table'),
    head = table.createTHead().insertRow();
  for (const { title, accessible } of headers.map((heading) =>
    typeof heading === 'string' ? { title: heading } : heading,
  )) {
    const cell = elem('th', title);
    if (accessible) cell.setAttribute('aria-label', accessible);
    cell.scope = 'col';
    head.append(cell);
  }
  const body = table.createTBody();
  for (const values of rows) {
    const tr = body.insertRow();
    for (const value of values)
      tr.insertCell().append(value instanceof Node ? value : document.createTextNode(String(value)));
  }
  container.append(table);
}
function selectHistory(key) {
  for (const tab of ['entries', 'deposits']) {
    $('show-' + tab).setAttribute('aria-pressed', String(tab === key));
    $(tab).hidden = tab !== key;
  }
}
for (const tab of ['entries', 'deposits']) $('show-' + tab).onclick = () => selectHistory(tab);
const depositForm = $('deposit-form');
const rechargeOptions = [...depositForm.querySelectorAll('[data-amount]')];
const customRechargeAmount = depositForm.elements.customAmount;
let selectedRechargeAmount = '50';
for (const option of rechargeOptions) {
  option.onclick = () => {
    selectedRechargeAmount = option.dataset.amount;
    for (const button of rechargeOptions) {
      button.setAttribute('aria-pressed', String(button === option));
    }
    const custom = selectedRechargeAmount === 'more';
    $('custom-recharge-amount').hidden = !custom;
    customRechargeAmount.disabled = !custom;
    if (custom) customRechargeAmount.focus();
  };
}
function openRecharge() {
  if (!wallet || $('recharge').hidden || document.querySelector('dialog[open]')) return;
  $('deposit-dialog').querySelector('.modal-feedback').hidden = true;
  showModal($('deposit-dialog'), depositForm.querySelector('[aria-pressed=true]'));
}
$('recharge').onclick = openRecharge;
document.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => $(b.dataset.close).close()));
async function loadWallet() {
  wallet = await api('/api/commerce/wallet');
  $('account').textContent = wallet.email;
  $('staff-admin-link').hidden = !wallet.canManageAccounts;
  $('review-link').hidden = wallet.role !== 'admin';
  const rechargeAllowed = wallet.role !== 'employee';
  $('shop-balance').textContent = money(wallet.availableRaw);
  $('address-price-value').textContent = money(wallet.priceAddressRaw).replace(' U', '');
  $('address-pay').textContent = '支付 ' + money(wallet.priceAddressRaw) + ' 并生成';
  $('address-pay').disabled = false;
  $('supplier-funds').hidden = !wallet.canManageAccounts;
  $('supplier-balance').textContent = Number.isSafeInteger(wallet.esimSupplierBalanceRaw)
    ? dollars.format(wallet.esimSupplierBalanceRaw / 10000)
    : '暂不可用';
  $('shop-recharge').hidden = !rechargeAllowed;
  if (view !== 'wallet') return;
  $('balance').textContent = money(wallet.availableRaw).replace(' U', '');
  $('held').textContent = '订单预留 ' + money(wallet.heldRaw);
  $('held').hidden = !wallet.heldRaw;
  const select = $('deposit-form').elements.network,
    previous = select.value;
  $('recharge').hidden = !rechargeAllowed;
  $('employee-wallet').hidden = rechargeAllowed;
  select.replaceChildren();
  for (const n of wallet.networks) {
    const o = new Option(n.label + (n.enabled ? '' : '（暂不可用）'), n.id);
    o.disabled = !n.enabled;
    select.add(o);
  }
  select.value =
    wallet.networks.find((n) => n.id === previous && n.enabled)?.id ||
    wallet.networks.find((n) => n.enabled)?.id ||
    '';
  $('deposit-form').querySelector('[type=submit]').disabled = !select.value;
  ledgerTable(
    $('entries'),
    ['时间', '交易说明', '变动金额'],
    wallet.entries.map((e) => [
      ledgerDate(e.createdAt),
      e.reference.startsWith('legacy-quota:') ? '原合伙人额度转入' : e.note,
      elem('strong', (e.delta > 0 ? '+' : '') + money(e.delta), e.delta > 0 ? 'positive' : 'numeric'),
    ]),
    '暂无余额明细',
  );
}
async function loadDeposits() {
  const { orders } = await api('/api/commerce/deposits');
  historyOrders = orders;
  $('show-deposits').hidden = wallet.role === 'employee' && !orders.length;
  ledgerTable(
    $('deposits'),
    ['创建时间', '充值网络', '入账金额', '状态', { title: '', accessible: '操作' }],
    orders.map((o) => [
      ledgerDate(o.createdAt),
      networkName(o.network),
      money((o.creditedAmount ?? o.amount) * 10000),
      elem('span', statusText[o.status] || o.status, 'state state-' + o.status),
      button('详情', () => openInvoice(o.id, true)),
    ]),
    '暂无充值记录',
  );
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
  invoiceId = o.id;
  invoiceExpiry = o.expiresAt;
  const n = $('invoice-data');
  n.replaceChildren();
  const s = statusText[o.status] || o.status;
  const meta = elem('div', undefined, 'invoice-meta'),
    summary = elem('div', undefined, 'invoice-summary');
  meta.append(elem('strong', networkName(o.network)), elem('span', s, 'state state-' + o.status));
  summary.append(
    elem('span', o.status === 'credited' ? '已入账' : '预计入账'),
    elem('strong', (o.creditedAmount ?? o.amount) + ' U'),
  );
  n.append(meta, summary);
  if (o.status === 'pending' && Date.parse(o.expiresAt) > Date.now()) {
    const transfer = elem('div', undefined, 'invoice-transfer'),
      payment = elem('div', undefined, 'invoice-payment'),
      address = elem('div', undefined, 'invoice-address');
    payment.append(elem('span', '请精确支付'), elem('strong', o.expectedAmount + ' USDT', 'amount'));
    const timer = elem('p', '', 'timer');
    timer.id = 'countdown';
    payment.append(timer);
    const img = new Image();
    img.className = 'qr';
    img.alt = '收款地址二维码';
    img.src = '/api/commerce/deposit?id=' + encodeURIComponent(o.id) + '&qr=1';
    payment.append(
      button('复制应付金额', async () => {
        await navigator.clipboard.writeText(o.expectedAmount);
        message('应付金额已复制。');
      }),
    );
    transfer.append(img, payment);
    address.append(
      elem('span', '收款地址', 'invoice-label'),
      elem('code', o.address),
      button('复制地址', async () => {
        await navigator.clipboard.writeText(o.address);
        message('收款地址已复制。');
      }),
    );
    n.append(
      transfer,
      address,
      elem(
        'p',
        '请在所选网络转入完整应付金额，手续费另付。小数尾数用于识别订单，最多 0.09 USDT，尾数不计入余额。',
        'hint',
      ),
    );
    countdown();
  } else
    n.append(
      elem(
        'p',
        '订单应付 ' + o.expectedAmount + ' USDT' + (o.paidAmount ? ' · 已检测 ' + o.paidAmount + ' USDT' : ''),
        'hint',
      ),
    );
  if (o.txHash) n.append(elem('span', '交易哈希', 'invoice-label'), elem('code', o.txHash));
  n.dataset.state = o.status;
}
async function openInvoice(id, show = false) {
  const { order } = await api('/api/commerce/deposit?id=' + encodeURIComponent(id));
  const old = $('invoice-data').dataset.state;
  displayInvoice(order);
  if (show && !$('invoice').open) {
    $('invoice').querySelector('.modal-feedback').hidden = true;
    showModal($('invoice'));
  }
  if (old && old !== order.status) await Promise.all([loadWallet(), loadDeposits()]);
}
form('deposit-form', async ({ network, customAmount }) => {
  const amount = selectedRechargeAmount === 'more' ? customAmount : selectedRechargeAmount;
  const key = 'deposit:' + network + ':' + String(Number(amount));
  const { order } = await api('/api/commerce/deposits', { network, amount, requestId: keyFor(key) });
  clearKey(key);
  displayInvoice(order);
  $('deposit-dialog').close();
  $('invoice').querySelector('.modal-feedback').hidden = true;
  showModal($('invoice'));
  selectHistory('deposits');
  await loadDeposits();
});
form('pin-form', async (f, el) => {
  await api('/api/settings/security', f);
  el.reset();
  message('支付密码已更新。');
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
          inputField('入账金额（U）', 'principal', { type: 'number', min: '0.01', step: '0.01' }),
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
      [p.countryName, operators].filter(Boolean).join(' · '),
      packageAction(p),
    ).parentElement.classList.add('product-card');
  }
  empty(n, '没有找到套餐。');
  hasNext = r.hasMore;
  $('prev').disabled = !offset;
  $('next').disabled = !hasNext;
}
function packageAction(pack) {
  const action = elem('div', undefined, 'product-action');
  action.append(
    elem('strong', money(pack.priceRaw)),
    button('购买', () => buy(pack)),
  );
  return action;
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
async function needsPin(quote) {
  if (quote.pinConfigured !== false) return false;
  const next = await ask('设置支付密码', [elem('p', '购买前请先为账户设置六位支付密码。')]);
  if (next) location.assign('/__host/security');
  return true;
}
function esimFunding(quote) {
  return quote.paymentSource === 'supplier'
    ? '按 eSIMAccess 原价结算 · 供应商可用余额 '+dollars.format(quote.availableRaw/10000)
    : '钱包可用余额 ' + money(quote.availableRaw);
}
async function buy(p) {
  const q = await api('/api/esim/purchase-quote', { ids: [p.id] });
  if (q.pending) throw Error('你有一笔订单正在核对，请查看我的订单。');
  if (await needsPin(q)) return;
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
    elem('p', '每张 ' + money(line.priceRaw)),
    elem('p', esimFunding(q)),
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
  if (await needsPin(q)) return;
  const card = q.cards?.[0];
  if (!card?.options?.length) throw Error(card?.reason || '当前没有可续费方案。');
  const opts = card.options.map((x) => [x.code, x.name + ' · ' + money(x.priceRaw)]);
  const f = await ask('续费 · ' + c.name, [elem('p', esimFunding(q)), inputField('续费套餐', 'code', { options: opts }), pinField()]);
  if (!f) return;
  await api('/api/esim/renewals', { id: q.id, ...f });
  message('续费已提交，结果可在我的订单中查看。');
  await Promise.all([loadOrders(), loadWallet()]);
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
      { profile, template: { id: t.id, name: t.name }, pin: f.pin, quotedPriceRaw: wallet.priceAddressRaw },
      { 'idempotency-key': keyFor(k) },
    );
  } catch (e) {
    if (e.status >= 400 && e.status < 500) clearKey(k);
    if (e.status === 409) await loadWallet().catch(() => {});
    throw e;
  }
  clearKey(k);
  el.reset();
  const paid = money(r.paidAmountRaw);
  const receipt =
    r.paymentStatus === 'refunded'
      ? '订单未完成，' + paid + ' 已退回余额。'
      : r.paymentStatus === 'reserved'
        ? '原订单已预留 ' + paid + '。'
        : '已支付 ' + paid + '。';
  message(receipt + '订单号 ' + r.requestNo);
  await Promise.all([loadOrders(), loadWallet()]);
});
async function digest(t) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t))), (x) =>
    x.toString(16).padStart(2, '0'),
  ).join('');
}
(async () => {
  try {
    const title = { shop: '资源市场', wallet: '我的钱包', security: '支付密码', 'payment-review': '收款核对' }[
      view
    ];
    $('title').textContent = title;
    $('page-intro').textContent = {
      shop: '浏览资源、下单和管理购买记录。',
      wallet: '查看可用余额和账户流水。',
      security: '设置六位支付密码，用于确认购买和下载。',
      'payment-review': '查看收款网络和需要人工核对的转账。',
    }[view];
    document.title = title + ' · Lumen';
    document.body.dataset.view = view;
    if (embedded) {
      document.body.classList.add('embedded-wallet');
      for (const a of document.querySelectorAll('a[href]')) a.target = '_top';
      new ResizeObserver(() =>
        postToWorkspace('lumen:wallet-height', {
          height: Math.ceil(document.querySelector('main').getBoundingClientRect().height),
        }),
      ).observe(document.querySelector('main'));
      window.addEventListener('message', (e) => {
        if (e.origin === location.origin && e.source === parent && e.data?.type === 'lumen:wallet-open-recharge')
          openRecharge();
      });
    }
    $(view).hidden = false;
    const walletLink = document.querySelector('.wallet-link');
    walletLink.href = walletPage;
    const activeNav = view === 'wallet' ? walletLink : view === 'shop' ? $('resource-home') : document.querySelector(`header a[href="/__host/${view}"]`);
    activeNav?.setAttribute('aria-current', 'page');
    await loadWallet();
    if (view === 'shop') await Promise.all([catalog(), loadOrders()]);
    if (view === 'wallet') {
      const oldCredit = new URL(location.href).searchParams.get('credit');
      if (wallet.canManageAccounts && oldCredit) {
        location.replace('/__host/accounts?credit=' + encodeURIComponent(oldCredit));
        return;
      }
      const orders = await loadDeposits();
      if (orders.some((o) => o.status === 'pending' || o.status === 'confirming')) selectHistory('deposits');
      if (page.searchParams.get('action') === 'recharge') {
        page.searchParams.delete('action');
        history.replaceState(null, '', page);
        openRecharge();
      }
    }
    if (view === 'payment-review') await admin();
  } catch (e) {
    message(e.message, true);
  } finally {
    postToWorkspace('lumen:wallet-ready');
  }
})();
setInterval(countdown, 1000);
let polling = false;
let refreshHistoryAt = 0;
setInterval(async () => {
  if (
    view === 'wallet' &&
    wallet &&
    !polling &&
    !document.hidden &&
    !$('invoice').open &&
    !document.querySelector('dialog[open]') &&
    Date.now() >= refreshHistoryAt &&
    historyOrders.some((o) => ['pending', 'confirming'].includes(o.status))
  ) {
    refreshHistoryAt = Date.now() + 20000;
    polling = true;
    try {
      await Promise.all([loadWallet(), loadDeposits()]);
    } catch (e) {
      message(e.message, true);
    } finally {
      polling = false;
    }
    return;
  }
  if (
    document.hidden ||
    polling ||
    !$('invoice').open ||
    !invoiceId ||
    ['credited', 'review', 'expired'].includes($('invoice-data').dataset.state)
  )
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
