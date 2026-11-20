(() => {
  const walletUrl = '/?section=wallet';
  const amount = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 });
  let wallet, dashboard, links, snapshot;
  let showingWallet = new URL(location.href).searchParams.get('section') === 'wallet';
  let rechargeOnOpen = new URL(location.href).searchParams.get('action') === 'recharge';
  let pendingRefresh = false;
  let scheduled = false;
  const marketListeners = new Set();
  let marketSelection = [];

  const link = (label, href, className) => {
    const a = document.createElement('a');
    a.href = href;
    a.className = className;
    a.textContent = label;
    return a;
  };

  function walletLink(label, className, recharge = false) {
    const a = link(label, walletUrl + (recharge ? '&action=recharge' : ''), className);
    a.addEventListener('click', (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
      const closeMenu = a.closest('aside')?.querySelector(':scope > div:first-child button');
      if (closeMenu && getComputedStyle(closeMenu).display !== 'none') closeMenu.click();
      if (!dashboard?.isConnected) return location.assign(a.href);
      if (!showingWallet) history.pushState(history.state, '', a.getAttribute('href'));
      showingWallet = true;
      rechargeOnOpen = recharge;
      renderView();
      dashboard.querySelector('h1').focus({ preventScroll: true });
      dashboard.scrollIntoView({ block: 'start' });
    });
    return a;
  }

  function walletPanel() {
    const section = document.createElement('section');
    section.id = 'lumen-wallet-panel';
    section.setAttribute('aria-labelledby', 'lumen-wallet-heading');
    section.innerHTML = '<div class="lumen-wallet-heading"><h1 id="lumen-wallet-heading" tabindex="-1">钱包 / 充值</h1></div><div class="lumen-wallet-frame"></div>';
    return section;
  }

  function walletSummary() {
    const section = document.createElement('section');
    section.id = 'lumen-wallet-summary';
    section.setAttribute('aria-labelledby', 'lumen-wallet-summary-heading');
    section.innerHTML = '<span class="lumen-wallet-glyph" aria-hidden="true"></span><div class="lumen-wallet-summary-label"><h2 id="lumen-wallet-summary-heading">钱包 / 充值</h2><p>可用余额 <strong aria-live="polite">—</strong></p><p data-supplier-funds hidden>eSIMAccess 供应商余额 <strong>—</strong></p></div><div class="lumen-wallet-summary-actions"></div>';
    const actions = section.lastElementChild;
    actions.append(walletLink('查看账单', 'lumen-wallet-secondary'));
    const recharge = walletLink('充值 USDT', 'lumen-wallet-primary', true);
    recharge.hidden = true;
    actions.append(recharge);
    return section;
  }

  function displayBalance() {
    if (!links || !snapshot) return;
    links.querySelector('strong').textContent = amount.format(snapshot.availableRaw / 10000) + ' U';
    links.querySelector('.lumen-wallet-primary').hidden = snapshot.role === 'employee' || !snapshot.networks?.length;
    const supplier = links.querySelector('[data-supplier-funds]');
    supplier.hidden = !snapshot.canManageAccounts;
    supplier.querySelector('strong').textContent = Number.isSafeInteger(snapshot.esimSupplierBalanceRaw)
      ? dollars.format(snapshot.esimSupplierBalanceRaw / 10000) : '暂不可用';
  }

  async function refreshBalance() {
    if (pendingRefresh) return;
    pendingRefresh = true;
    try {
      const response = await fetch('/api/commerce/wallet', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw Error();
      snapshot = await response.json();
      displayBalance();
      syncNavigation();
      for (const listener of marketListeners) listener();
    } catch {
      if (links && !snapshot) links.querySelector('strong').textContent = '暂不可用';
    } finally {
      pendingRefresh = false;
    }
  }

  function syncNavigation() {
    const nav = document.querySelector('aside nav');
    if (!nav) return;
    const items = [...nav.querySelectorAll('button,a')];
    const trigger = items.find((el) => el.textContent.trim() === '我的购买');
    if (!trigger) return;
    let walletNav = nav.querySelector('#lumen-wallet-link');
    if (!walletNav) {
      walletNav = walletLink('钱包 / 充值', 'lumen-wallet-nav');
      walletNav.id = 'lumen-wallet-link';
      const glyph = document.createElement('span');
      glyph.className = 'lumen-wallet-glyph';
      glyph.setAttribute('aria-hidden', 'true');
      walletNav.prepend(glyph);
      trigger.after(walletNav);
    }
    if (showingWallet) walletNav.setAttribute('aria-current', 'page');
    else walletNav.removeAttribute('aria-current');
    const legacyWallet = items.find((el) => ['我的钱包', '账户余额'].includes(el.textContent.trim()));
    if (legacyWallet) legacyWallet.dataset.lumenLegacyWallet = '';
    if (snapshot?.canManageAccounts && !nav.querySelector('#lumen-employees-link')) {
      const existing = items.find((el) => ['账号与额度', '合伙人与额度'].includes(el.textContent.trim()));
      if (existing) {
        existing.dataset.lumenLegacyWallet = '';
        const staff = link('合伙人与额度', '/__host/accounts', trigger.className);
        staff.id = 'lumen-employees-link';
        const icon = existing.querySelector('svg');
        if (icon) staff.prepend(icon.cloneNode(true));
        existing.after(staff);
      }
    }
  }

  function renderView() {
    const main = document.querySelector('div > main:has(> header)');
    if (!main) return;
    if (!dashboard?.isConnected) {
      wallet = null;
      dashboard = walletPanel();
      links = walletSummary();
      const header = main.querySelector(':scope > header');
      header.after(links, dashboard);
      displayBalance();
    }
    main.toggleAttribute('data-lumen-wallet-view', showingWallet);
    dashboard.hidden = !showingWallet;
    syncNavigation();
    if (showingWallet && !wallet) {
      wallet = document.createElement('iframe');
      wallet.src = '/__host/wallet?embedded=1' + (rechargeOnOpen ? '&action=recharge' : '');
      wallet.title = '钱包余额、充值与账单';
      wallet.height = '690';
      dashboard.lastElementChild.append(wallet);
    } else if (!showingWallet && wallet) {
      wallet.remove();
      wallet = null;
      refreshBalance();
    }
  }

  function refreshWalletView() {
    const params = new URL(location.href).searchParams;
    showingWallet = params.get('section') === 'wallet';
    rechargeOnOpen = params.get('action') === 'recharge';
    renderView();
  }

  window.addEventListener('popstate', refreshWalletView);
  window.addEventListener('message', (event) => {
    if (!wallet || event.origin !== location.origin || event.source !== wallet.contentWindow) return;
    const { type, height } = event.data || {};
    if (type === 'lumen:wallet-height' && Number.isFinite(height) && height > 0) {
      wallet.height = String(Math.min(16000, Math.ceil(height)));
    }
    if (type === 'lumen:wallet-dialog-open' && wallet.getBoundingClientRect().top < 75) {
      wallet.scrollIntoView({ block: 'start' });
    }
  });
  document.addEventListener('click', (event) => {
    if (!showingWallet || !(event.target instanceof Element)) return;
    const selected = event.target.closest('aside nav button, aside > button, main > header [class*="absolute"] button');
    if (!selected) return;
    const url = new URL(location.href);
    url.searchParams.delete('section');
    url.searchParams.delete('action');
    history.replaceState(history.state, '', url);
    refreshWalletView();
  });
  const sync = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      renderView();
    });
  };
  function startDashboard() {
    if (started) return;
    started = true;
    requestObserver?.disconnect();
    new MutationObserver(sync).observe(document.body, { subtree: true, childList: true });
    window.addEventListener('pageshow', refreshBalance);
    renderView();
    refreshBalance();
  }

  // The existing workbench fetches its session from a React effect after hydration.
  let started = false;
  let requestObserver;
  const sessionUrl = location.origin + '/api/session';
  const sessionLoaded = (entry) => entry.name === sessionUrl;
  if (performance.getEntriesByType('resource').some(sessionLoaded)) startDashboard();
  else if (window.PerformanceObserver?.supportedEntryTypes?.includes('resource')) {
    requestObserver = new PerformanceObserver((list) => {
      if (list.getEntries().some(sessionLoaded)) startDashboard();
    });
    requestObserver.observe({ type: 'resource', buffered: true });
  }
  // Keep the wallet reachable when session lookup is delayed or performance entries are unavailable.
  window.addEventListener('load', () => setTimeout(startDashboard, 1800), { once: true });

  if (window.LumenMarketTable) {
    window.lumenMountMarket = (host) => {
      let options;
      const market = window.LumenMarketTable.mount(host, {
        async load(params, signal) {
          if (options?.ids !== null && options?.ids !== undefined) params.set('ids', options.ids.join(','));
          const response = await fetch('/api/esim/packages?' + params.toString(), { signal, cache: 'no-store' });
          if (response.status === 401) {
            location.assign('/__host/login?returnTo=%2F');
            throw Error('请重新登录。');
          }
          const result = await response.json();
          if (!response.ok || !result.connected) throw Error(result.error || '供应商目录暂时不可用。');
          return result;
        },
        checkout(items, accepted) {
          const ids = [...new Set(items.map((item) => item.id))];
          if (!ids.length) return;
          window.dispatchEvent(new CustomEvent('lumen:checkout', {
            detail: {
              ids,
              security: () => options?.openSecurity(),
              accepted() {
                accepted?.();
                refreshBalance();
              },
            },
          }));
        },
        toggleFavorite: (id) => options?.toggleFavorite(id),
        resetQuery: () => options?.resetQuery(),
        selectedChanged: (items) => { marketSelection = items; },
      });
      function update() {
        if (!options) return;
        const direct = Boolean(snapshot?.canManageAccounts);
        market.update({
          scopeKey: JSON.stringify([options.scope, options.ids]),
          scopeLabel: options.scopeLabel,
          query: options.query,
          favoriteIds: options.favoriteIds,
          selectedItems: marketSelection,
          favoriteOnly: options.scope === 'favorites',
          balanceRaw: (direct ? snapshot?.esimSupplierBalanceRaw : snapshot?.availableRaw) ?? null,
          currency: direct ? 'USD' : 'U',
          balanceLabel: direct ? '供应商余额' : '钱包可用余额',
        });
      }
      marketListeners.add(update);
      return {
        update(next) { options = next; update(); },
        destroy() { marketListeners.delete(update); market.destroy(); },
      };
    };
    window.dispatchEvent(new Event('lumen:market-ready'));
  }

  function paymentPin(priceRaw) {
    const price = amount.format(priceRaw / 10000);
    return new Promise((resolve) => {
      const dialog = document.createElement('dialog');
      dialog.className = 'lumen-payment-dialog';
      dialog.setAttribute('aria-labelledby', 'lumen-payment-title');
      dialog.innerHTML = `
        <form method="dialog">
          <div class="lumen-payment-header">
            <h2 id="lumen-payment-title">确认付款</h2>
            <p>地址证明生成</p>
          </div>
          <div class="lumen-payment-body">
            <div class="lumen-payment-total"><span>应付金额</span><strong>${price} <small>U</small></strong></div>
            <p>付款后开始处理。订单失败时，费用会退回账户余额。</p>
            <label>六位支付密码<input type="password" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" required autocomplete="off"></label>
            <div class="lumen-payment-links"><a href="/?section=wallet">查看余额</a><a href="/__host/security">设置支付密码</a></div>
          </div>
          <footer><button class="lumen-wallet-secondary" value="cancel" formnovalidate>取消</button><button class="lumen-wallet-primary" value="ok">确认支付 ${price} U</button></footer>
        </form>`;
      document.body.append(dialog);
      dialog.onclose = () => {
        const pin = dialog.returnValue === 'ok' ? dialog.querySelector('input').value : null;
        dialog.remove();
        resolve(pin);
      };
      dialog.showModal();
      dialog.querySelector('input').focus();
    });
  }
  window.lumenSubmitAddress = async function (path, options) {
    let price;
    try {
      const response = await fetch('/api/commerce/address/price', { cache: 'no-store' });
      if (!response.ok) throw Error();
      const quote = await response.json();
      if (!Number.isSafeInteger(quote.priceRaw)) throw Error();
      price = quote.priceRaw;
    } catch {
      return Response.json({ error: '暂时无法读取售价，请稍后重试。' }, { status: 503 });
    }
    const pin = await paymentPin(price);
    if (!pin) return Response.json({ error: '已取消提交。' }, { status: 400 });
    const fingerprint = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(options.body))),
      (x) => x.toString(16).padStart(2, '0'),
    ).join('');
    const name = 'lumen-address:' + fingerprint,
      key = sessionStorage.getItem(name) || crypto.randomUUID();
    sessionStorage.setItem(name, key);
    const res = await fetch(path, {
      ...options,
      headers: { ...options.headers, 'idempotency-key': key },
      body: JSON.stringify({ ...JSON.parse(options.body), pin, quotedPriceRaw: price }),
    });
    if (res.ok || (res.status >= 400 && res.status < 500)) sessionStorage.removeItem(name);
    return res;
  };
})();
