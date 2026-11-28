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
  $('refund-admin-link').hidden = !wallet.canManageAccounts;
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
    ['创建时间', '充值网络', '充值本金', '入账金额', '状态', { title: '', accessible: '操作' }],
    orders.map((o) => [
      ledgerDate(o.createdAt),
      networkName(o.network),
      money(o.amount * 10000),
      o.status === 'credited' && o.creditedAmount != null ? money(o.creditedAmount * 10000) : '—',
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
      elem(
        'p',
        '交易所提币：请确保扣除手续费后的实际到账金额等于订单应付金额。',
        'recon-payment-warning',
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
const reconciliationReasons = {
  unmatched: '未匹配订单',
  amount_mismatch: '金额不匹配',
  outside_window: '超出付款窗口',
  extra: '订单已入账',
};
const reviewForm = $('review-form');
let reviewItem = null, reviewAction = 'credit', reviewPosting = false;
let reviewOriginalCandidates = [], reviewLookupTicket = 0;
let reviewLoadTicket = 0;
function reconField(label, value, className) {
  const field = elem('div', undefined, 'recon-field');
  const content = value instanceof Node ? value : elem('strong', String(value));
  if (className) content.classList.add(className);
  field.append(elem('span', label), content);
  return field;
}
function reconHash(item) {
  const field = elem('div', undefined, 'recon-hash');
  const hash = elem('code', item.txHash);
  const tools = elem('div', undefined, 'recon-hash-tools');
  const link = elem('a', '查看链上交易');
  const base = {
    BSC: 'https://bscscan.com/tx/',
    ETH: 'https://etherscan.io/tx/',
    TRON: 'https://tronscan.org/#/transaction/',
  }[item.network];
  if (base && /^0x[\da-f]{64}$/i.test(item.txHash)) {
    link.href = base + (item.network === 'TRON' ? item.txHash.slice(2) : item.txHash);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    tools.append(link);
  }
  tools.append(button('复制哈希', async () => {
    await navigator.clipboard.writeText(item.txHash);
    message('交易哈希已复制。');
  }));
  field.append(elem('span', '交易哈希'), hash, tools);
  return field;
}
function reconTransfer(item) {
  const card = elem('article', undefined, 'recon-transfer');
  const top = elem('div', undefined, 'recon-transfer-heading');
  const amount = elem('div', undefined, 'recon-amount');
  amount.append(elem('span', '实际到账'), elem('strong', item.paidAmount + ' USDT'));
  const flags = elem('div', undefined, 'recon-flags');
  flags.append(elem('span', item.network, 'state'), elem('span', '已确认到账', 'state state-credited'),
    elem('span', reconciliationReasons[item.reason] || item.reason, 'state state-review'));
  top.append(amount, flags);
  const details = elem('div', undefined, 'recon-metadata');
  details.append(reconField('到账时间', ledgerDate(item.blockTime * 1000)));
  if (item.accountEmail || item.orderId) {
    details.append(reconField('关联账号', item.accountEmail || '—'));
    if (item.orderId) details.append(reconField('关联充值订单', elem('code', item.orderId)));
  } else {
    details.append(reconField('关联充值订单', '未匹配订单'));
  }
  const bottom = elem('div', undefined, 'recon-transfer-footer');
  const eligible = item.candidates?.filter((c) => c.canCredit && c.email && c.recommendedCredit > 0) || [];
  const count = elem('div', undefined, 'recon-candidate-count');
  count.append(elem('span', '可核对候选订单'), elem('strong', String(eligible.length)));
  const actions = elem('div', undefined, 'buttons');
  const credit = button('匹配订单补单', () => openReview(item, 'credit'));
  credit.className = '';
  actions.append(button('仅记录核对结果', () => openReview(item, 'acknowledge')), credit);
  bottom.append(count, actions);
  if (!eligible.length) bottom.append(elem('p', '暂无可入账的候选订单。可使用完整订单编号查找。', 'hint'));
  card.append(top, details, reconHash(item), bottom);
  return card;
}
function reconHistory(item) {
  const card = elem('article', undefined, 'recon-transfer recon-history-card');
  const top = elem('div', undefined, 'recon-transfer-heading');
  const summary = elem('div');
  const label = item.action === 'credit' ? '已补单' : '已记录核对结果';
  summary.append(elem('span', label, 'state state-credited'),
    elem('strong', item.action === 'credit' ? money(item.creditedPrincipal * 10000) : '未增加余额', 'recon-history-amount'));
  const details = elem('div', undefined, 'recon-metadata');
  details.append(reconField('到账时间', ledgerDate(item.blockTime * 1000)),
    reconField('实际到账', item.paidAmount + ' USDT'),
    reconField('处理时间', ledgerDate(item.resolvedMs)),
    reconField('处理人', item.actorEmail || item.actor || '—'));
  if (item.action === 'credit') {
    details.append(reconField('入账账号', item.creditedEmail || item.accountEmail || '—'));
    if (item.orderId) details.append(reconField('关联充值订单', elem('code', item.orderId)));
  }
  const note = elem('div', undefined, 'recon-note');
  const noteText = elem('p', item.note || '—');
  noteText.setAttribute('data-lumen-no-translate', '');
  note.append(elem('span', '核对备注'), noteText);
  top.append(summary, elem('span', item.network, 'state'));
  card.append(top, details, reconHash(item), note);
  return card;
}
function searchableHash() {
  const raw = $('review-hash').value.trim();
  if (!raw) return '';
  if (!/^(?:0x)?[0-9a-f]{1,64}$/i.test(raw)) throw Error('请输入有效的交易哈希或前缀。');
  return raw;
}
async function admin() {
  const txHash = searchableHash();
  const ticket = ++reviewLoadTicket;
  const path = '/api/commerce/admin/deposits' + (txHash ? '?' + new URLSearchParams({ txHash }) : '');
  const r = await api(path);
  if (ticket !== reviewLoadTicket) return;
  const reviews = r.reviews || [];
  const history = r.history || [];
  $('review-count').textContent = String(reviews.length);
  $('review-history-count').textContent = String(history.length);
  $('review-network-count').textContent = String(r.health.filter((x) => x.enabled).length);
  const health = $('health');
  health.replaceChildren();
  for (const x of r.health) {
    const node = elem('div', undefined, 'recon-network');
    const status = x.error ? '监控异常' : x.enabled ? '已配置' : '未启用';
    node.append(elem('strong', x.label), elem('span', status, 'state state-' + (x.error ? 'review' : x.enabled ? 'credited' : 'expired')));
    if (x.lastFinalizedBlock != null) node.append(reconField('已扫描区块', String(x.lastFinalizedBlock)));
    if (x.error) node.append(elem('small', x.error));
    health.append(node);
  }
  $('reviews').replaceChildren(...reviews.map(reconTransfer));
  $('review-history').replaceChildren(...history.map(reconHistory));
  empty($('reviews'), txHash ? '没有符合此交易哈希的待核对转账。' : '暂无待核对转账');
  empty($('review-history'), txHash ? '没有符合此交易哈希的已处理记录。' : '暂无已处理记录');
  $('reviews').removeAttribute('aria-busy');
  $('review-history').removeAttribute('aria-busy');
}
function selectedReviewOrder() {
  const id = reviewForm.querySelector('input[name=orderId]:checked')?.value;
  return reviewItem?.candidates?.find((candidate) =>
    candidate.id === id && candidate.canCredit && candidate.email && candidate.recommendedCredit > 0);
}
function updateReviewSelection(reset = false) {
  const order = reviewAction === 'credit' ? selectedReviewOrder() : null;
  const principal = reviewForm.elements.principal;
  const selection = $('review-selection');
  if (reset) {
    reviewForm.elements.confirmed.checked = false;
    if (order) {
      principal.max = Number(order.recommendedCredit).toFixed(2);
      principal.value = principal.max;
      $('review-selection-summary').replaceChildren(
        reconField('入账账号', order.email),
        reconField('应付金额', order.expectedAmount + ' USDT'),
        reconField('实际到账', reviewItem.paidAmount + ' USDT'),
        reconField('最高可入账', principal.max + ' U'),
      );
    } else {
      principal.value = '';
      principal.removeAttribute('max');
    }
  }
  principal.disabled = reviewPosting || !order;
  selection.hidden = !order;
  $('review-submit').disabled = reviewPosting || (reviewAction === 'credit' && !order)
    || !reviewForm.elements.note.value.trim() || !reviewForm.elements.confirmed.checked
    || (reviewAction === 'credit' && !principal.validity.valid);
}
function openReview(item, action) {
  if (reviewPosting || $('review-dialog').open) return;
  reviewLookupTicket++;
  reviewItem = { ...item };
  reviewOriginalCandidates = item.candidates || [];
  reviewAction = action;
  reviewForm.reset();
  $('review-order-id').value = '';
  const credit = action === 'credit';
  $('review-dialog-title').textContent = credit ? '确认充值补单' : '记录核对结果';
  $('review-submit').textContent = credit ? '确认补单' : '确认记录';
  $('review-confirm-label').textContent = credit
    ? '我已核实交易归属，确认向所选订单账号入账。'
    : '我确认只记录处理结果，不增加余额，并将此款项从待处理列表移除。';
  $('review-transfer').replaceChildren(
    reconField('实际到账', item.paidAmount + ' USDT'),
    reconField('充值网络', item.network),
    reconField('到账时间', ledgerDate(item.blockTime * 1000)),
    reconHash(item),
  );
  $('review-candidates').hidden = !credit;
  renderReviewOptions(credit ? reviewOriginalCandidates : []);
  $('review-dialog').querySelector('.modal-feedback').hidden = true;
  $('review-dialog').querySelector('.modal-feedback').textContent = '';
  updateReviewSelection(true);
  showModal($('review-dialog'));
}
function renderReviewOptions(candidates) {
  reviewItem.candidates = candidates;
  const options = $('review-option-list');
  options.replaceChildren();
  if (reviewAction === 'credit') {
    for (const c of candidates) {
      const row = elem('label', undefined, 'recon-option');
      const control = document.createElement('input');
      control.type = 'radio';
      control.name = 'orderId';
      control.value = c.id;
      control.required = true;
      control.disabled = !c.canCredit || !c.email || !(c.recommendedCredit > 0);
      control.onchange = () => updateReviewSelection(true);
      const content = elem('div', undefined, 'recon-option-content');
      const header = elem('div', undefined, 'recon-option-header');
      header.append(elem('strong', c.email || c.accountEmail || '账号不可用'),
        elem('span', statusText[c.status] || c.status, 'state state-' + c.status));
      const meta = elem('div', undefined, 'recon-option-meta');
      meta.append(reconField('充值本金', c.amount + ' U'),
        reconField('应付金额', c.expectedAmount + ' USDT'),
        reconField('最高可入账', Number(c.recommendedCredit).toFixed(2) + ' U'),
        reconField('订单创建时间', ledgerDate(c.createdAt)),
        reconField('订单有效期至', ledgerDate(c.expiresAt)),
        reconField('到账是否在有效期内', c.withinWindow ? '是' : '否'));
      content.append(header, meta, reconField('充值订单编号', elem('code', c.id)));
      if (control.disabled) content.append(elem('p', '此订单不可补单。', 'hint'));
      row.append(control, content);
      options.append(row);
    }
    if (!candidates.length) options.append(elem('p', '暂无可用订单，请核对完整订单编号。', 'hint'));
  }
  updateReviewSelection(true);
}
$('review-find-order').onclick = () => run($('review-find-order'), async () => {
  if (!reviewItem || reviewAction !== 'credit' || reviewPosting) return;
  const orderId = $('review-order-id').value.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) throw Error('请输入完整的充值订单编号。');
  const ticket = ++reviewLookupTicket;
  const { txHash, logIndex, network } = reviewItem;
  const data = await api('/api/commerce/admin/deposits?' + new URLSearchParams({ txHash, orderId }));
  if (ticket !== reviewLookupTicket || reviewPosting || !$('review-dialog').open) return;
  const item = data.reviews.find((record) => record.network === network && record.txHash === txHash && record.logIndex === logIndex);
  if (!item) throw Error('此转账已不在待核对列表中，请关闭并刷新。');
  renderReviewOptions(item.candidates || []);
});
$('review-restore-orders').onclick = () => {
  if (!reviewItem || reviewPosting) return;
  reviewLookupTicket++;
  $('review-order-id').value = '';
  renderReviewOptions(reviewOriginalCandidates);
};
$('review-order-id').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    $('review-find-order').click();
  }
});
reviewForm.addEventListener('input', (event) => {
  if (event.target.name !== 'confirmed' && event.target.name !== 'orderId') reviewForm.elements.confirmed.checked = false;
  updateReviewSelection(false);
});
$('review-dialog').addEventListener('cancel', (event) => {
  if (reviewPosting) event.preventDefault();
});
reviewForm.onsubmit = async (event) => {
  event.preventDefault();
  if (reviewPosting || !reviewItem || !reviewForm.reportValidity()) return;
  const item = reviewItem;
  const action = reviewAction;
  const selected = selectedReviewOrder();
  const data = new FormData(reviewForm);
  const note = String(data.get('note') || '').trim();
  if (!note || !data.get('confirmed') || (action === 'credit' && !selected)) return;
  const payload = {
    action, note, network: item.network, txHash: item.txHash, logIndex: item.logIndex,
    ...(action === 'credit' ? { email: selected.email, orderId: selected.id, principal: String(data.get('principal')) } : {}),
  };
  reviewPosting = true;
  const controls = [...reviewForm.querySelectorAll('input, button, textarea'), ...$('review-dialog').querySelectorAll('.dialog-head button')];
  const disabled = controls.map((control) => control.disabled);
  controls.forEach((control) => { control.disabled = true; });
  try {
    await api('/api/commerce/admin/review', payload);
    $('review-dialog').close();
    try {
      await admin();
      message(action === 'credit' ? '补单成功，余额及充值订单已更新。' : '处理结果已记录。');
    } catch {
      message('处理结果已记录，但列表刷新失败。请点击刷新核对，不要重复提交。');
    }
  } catch (error) {
    message(error.message, true);
  } finally {
    reviewPosting = false;
    controls.forEach((control, index) => { control.disabled = disabled[index]; });
    updateReviewSelection();
  }
};
form('review-search', admin);
$('review-refresh').onclick = () => run($('review-refresh'), admin);
$('review-reset').onclick = () => run($('review-reset'), async () => {
  $('review-hash').value = '';
  await admin();
});
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
function esimFunding(quote) {
  return quote.paymentSource === 'supplier'
    ? '按 eSIMAccess 原价结算 · 供应商可用余额 '+dollars.format(quote.availableRaw/10000)
    : '钱包可用余额 ' + money(quote.availableRaw);
}
async function buy(p) {
  const q = await api('/api/esim/purchase-quote', { ids: [p.id] });
  if (q.pending) throw Error('你有一笔订单正在核对，请查看我的订单。');
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
  ]);
  if (!f) return;
  const k = 'esim:' + p.id + ':' + f.count;
  let r;
  try {
    r = await api('/api/esim/purchases', {
      id: 'LH-' + keyFor(k),
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
  const f = await ask('续费 · ' + c.name, [elem('p', esimFunding(q)), inputField('续费套餐', 'code', { options: opts })]);
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
      { profile, template: { id: t.id, name: t.name }, quotedPriceRaw: wallet.priceAddressRaw },
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
      : r.paymentStatus === 'review' ? '订单异常，已转人工复核。' : r.paymentStatus === 'reserved'
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
    const title = { shop: '资源市场', wallet: '我的钱包', 'payment-review': '充值补单中心' }[
      view
    ];
    $('title').textContent = title;
    $('page-intro').textContent = {
      shop: '浏览资源、下单和管理购买记录。',
      wallet: '查看可用余额和账户流水。',
      'payment-review': '核对已确认但尚未入账的转账，关联充值订单并记录处理结果。',
    }[view];
    document.title = title + ' · Yorke AI';
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
