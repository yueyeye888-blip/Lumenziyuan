(() => {
  'use strict';

  const pageSize = 25;
  const maxSelection = 30;
  const gibibyte = 1024 ** 3;
  const mebibyte = 1024 ** 2;
  const activationNames = { 1: '安装时', 2: '首次连接时' };
  const dataNames = { 1: '总量套餐', 2: '每日流量 · 达量降速', 3: '每日流量 · 达量断网', 4: '每日不限量' };
  const numericText = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
  const preciseMoney = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  let nextTable = 0;

  function node(tag, text, cssClass) {
    const result = document.createElement(tag);
    if (text != null) result.textContent = text;
    if (cssClass) result.className = cssClass;
    return result;
  }

  function button(text, cssClass, handle) {
    const result = node('button', text, cssClass);
    result.type = 'button';
    if (handle) result.addEventListener('click', handle);
    return result;
  }

  function validPrice(price) {
    return Number.isSafeInteger(price) && price >= 0;
  }

  function formatVolume(plan) {
    if (Number(plan.dataType) === 4) return '不限量';
    if (!(Number.isFinite(plan.volume) && plan.volume > 0)) return '—';
    const useGb = plan.volume >= gibibyte;
    return numericText.format(plan.volume / (useGb ? gibibyte : mebibyte)) +
      (useGb ? ' GB' : ' MB') + ([2, 3].includes(Number(plan.dataType)) ? ' / 天' : '');
  }

  function formatDuration(plan) {
    if (plan.durationDays != null && Number.isFinite(plan.durationDays)) return numericText.format(plan.durationDays) + ' 天';
    if (!Number.isFinite(plan.duration) || plan.duration <= 0) return '—';
    const label = { HOUR: '小时', DAY: '天', MONTH: '月', YEAR: '年' }[String(plan.durationUnit).toUpperCase()];
    return label ? numericText.format(plan.duration) + ' ' + label : '—';
  }

  function loadFlagStyles() {
    if (document.querySelector('link[data-market-flags]')) return;
    const stylesheet = node('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = '/__host/market-flags.css';
    stylesheet.dataset.marketFlags = '';
    document.head.append(stylesheet);
  }

  function regionMark(plan) {
    const codes = Array.isArray(plan.regionCodes) ? plan.regionCodes : [];
    const code = codes.length === 1 ? codes[0] : !codes.length ? plan.location : '';
    const mark = node('span', null, 'lmt-region-mark');
    mark.setAttribute('aria-hidden', 'true');
    if (/^[A-Z]{2}$/.test(code || '')) mark.dataset.country = code;
    mark.append(node('span', null, 'lmt-region-globe'));
    return mark;
  }

  function operatorNames(plan) {
    if (!Array.isArray(plan.operators)) return [];
    return [...new Set(plan.operators.map(x => x?.name).filter(Boolean))];
  }

  function mount(container, { load, checkout, toggleFavorite, resetQuery, selectedChanged } = {}) {
    if (typeof load !== 'function') throw new TypeError('A catalog loader is required');
    loadFlagStyles();
    const id = 'lumen-market-' + ++nextTable;
    const root = node('section', null, 'lmt');
    root.setAttribute('aria-label', 'eSIM 套餐列表');
    root.innerHTML = `
      <form class="lmt-filter" autocomplete="off">
        <div class="lmt-filter-head">
          <div>
            <h2>筛选套餐</h2>
            <span class="lmt-filter-count" hidden></span>
          </div>
          <button type="button" class="lmt-text lmt-more" aria-expanded="false" aria-controls="${id}-extra">更多筛选<span aria-hidden="true">＋</span></button>
        </div>
        <div class="lmt-filter-grid">
          <label>国家 / 地区<select name="region"><option value="">全部国家或地区</option></select></label>
          <label>套餐名称<input name="name" type="search" maxlength="80" placeholder="搜索套餐名称"></label>
          <label>有效期（天）<input name="durationDays" type="number" min="0.01" step="any" placeholder="不限"></label>
          <label>流量类型<select name="dataType"><option value="">不限类型</option></select></label>
        </div>
        <div class="lmt-filter-grid lmt-extra" id="${id}-extra" hidden>
          <label>套餐编号（Slug）<input name="slug" type="search" maxlength="80" placeholder="输入套餐编号"></label>
          <label>开始计费<select name="activeType"><option value="">不限方式</option></select></label>
          <div class="lmt-amount">
            <label>流量大小<input name="dataAmount" type="number" min="0.01" step="any" placeholder="不限"></label>
            <label>单位<select name="dataUnit"><option>GB</option><option>MB</option></select></label>
          </div>
          <label>最高价格 <span class="lmt-filter-currency">（U）</span><input name="maxPrice" type="number" min="0.0001" step="any" placeholder="不限"></label>
        </div>
        <div class="lmt-filter-footer">
          <span class="lmt-query-note" hidden></span>
          <button type="button" class="lmt-secondary lmt-reset">重置</button>
          <button type="submit" class="lmt-primary">筛选</button>
        </div>
      </form>
      <section class="lmt-results" aria-labelledby="${id}-heading">
        <div class="lmt-results-toolbar">
          <header class="lmt-results-head">
            <div>
              <h2 id="${id}-heading" tabindex="-1">eSIM 套餐</h2>
              <p class="lmt-result-count" role="status" aria-live="polite">正在读取套餐…</p>
            </div>
            <label class="lmt-sort-mobile">排序<select aria-label="套餐排序"></select></label>
          </header>
          <div class="lmt-checkout">
            <div class="lmt-metric lmt-balance"><span>可用余额</span><strong>—</strong></div>
            <div class="lmt-metric lmt-selection"><span>已选套餐</span><strong>0</strong></div>
            <div class="lmt-metric lmt-total"><span>预估合计</span><strong>—</strong></div>
            <div class="lmt-checkout-actions">
              <button type="button" class="lmt-text lmt-clear" hidden>清空</button>
              <button type="button" class="lmt-primary lmt-pay" disabled>批量结算</button>
            </div>
          </div>
        </div>
        <p class="lmt-selection-feedback" role="status" aria-live="polite" hidden></p>
        <div class="lmt-table-scroll" role="region" tabindex="0" aria-label="套餐比较表">
          <table>
            <thead><tr>
              <th scope="col" class="lmt-check"><input type="checkbox" aria-label="选择本页套餐"></th>
              <th scope="col" class="lmt-plan">套餐</th>
              <th scope="col" class="lmt-price" data-sort="price"></th>
              <th scope="col" class="lmt-data" data-sort="data"></th>
              <th scope="col" class="lmt-duration" data-sort="duration"></th>
              <th scope="col" class="lmt-unit" data-sort="unitPrice"></th>
              <th scope="col" class="lmt-place">国家 / 地区</th>
              <th scope="col" class="lmt-actions">操作</th>
            </tr></thead>
            <tbody></tbody>
          </table>
        </div>
        <div class="lmt-status" hidden></div>
        <footer class="lmt-pages" hidden>
          <span class="lmt-page-range"></span>
          <div>
            <button type="button" class="lmt-secondary lmt-previous">上一页</button>
            <button type="button" class="lmt-secondary lmt-next">下一页</button>
          </div>
        </footer>
      </section>
      <dialog class="lmt-detail" aria-labelledby="${id}-detail-title">
        <header><h3 id="${id}-detail-title"></h3><button type="button" class="lmt-secondary lmt-close" aria-label="关闭套餐详情">关闭</button></header>
        <dl></dl>
      </dialog>
    `;
    container.append(root);

    const by = (selector) => root.querySelector(selector);
    const form = by('form');
    const fields = form.elements;
    const tbody = by('tbody');
    const choosePage = by('th input');
    const mobileSort = by('.lmt-sort-mobile select');
    const detail = by('dialog');
    const more = by('.lmt-more');
    const status = by('.lmt-status');
    const controls = [];
    const sortLabel = { price: '价格', data: '流量', duration: '有效期', unitPrice: '每 GB 价格' };

    let rows = [];
    let count = 0;
    let offset = 0;
    let hasMore = false;
    let busy = false;
    let controller = null;
    let initial = true;
    let scopeKey = '';
    let favoriteOnly = false;
    let queryTimer;
    let query = '';
    let sort = '';
    let direction = 'asc';
    let filters = new URLSearchParams();
    let favorites = new Set();
    let selected = new Map();
    let suppliersCurrency = false;
    let balanceLabel = '可用余额';
    let balanceRaw;
    let removed = false;

    function money(raw) {
      if (!validPrice(raw)) return '—';
      const display = preciseMoney.format(raw / 10_000);
      return suppliersCurrency ? '$' + display : display + ' U';
    }

    function sortBy(key, order) {
      direction = order || (sort === key && direction === 'asc' ? 'desc' : 'asc');
      sort = key;
      offset = 0;
      refresh();
    }

    mobileSort.add(new Option('默认顺序', ''));
    for (const [key, label] of Object.entries(sortLabel)) {
      mobileSort.add(new Option(label + '从低到高', key + ':asc'));
      mobileSort.add(new Option(label + '从高到低', key + ':desc'));
      const head = by('th[data-sort="' + key + '"]');
      const control = button(label, 'lmt-sort-button', () => sortBy(key));
      const arrows = node('span', null, 'lmt-arrows');
      arrows.setAttribute('aria-hidden', 'true');
      control.append(arrows);
      head.append(control);
      controls.push([key, head]);
    }
    mobileSort.addEventListener('change', () => {
      const [key, order] = mobileSort.value.split(':');
      sortBy(key, order);
    });

    function showExtra(expanded) {
      more.setAttribute('aria-expanded', String(expanded));
      more.lastElementChild.textContent = expanded ? '−' : '＋';
      by('.lmt-extra').hidden = !expanded;
    }
    more.addEventListener('click', () => showExtra(more.getAttribute('aria-expanded') !== 'true'));

    function readForm() {
      const result = new URLSearchParams();
      for (const key of ['region', 'name', 'slug', 'durationDays', 'activeType', 'dataType', 'dataAmount', 'maxPrice']) {
        const value = fields.namedItem(key).value.trim();
        if (value) result.set(key, value);
      }
      if (result.has('dataAmount')) result.set('dataUnit', fields.namedItem('dataUnit').value);
      return result;
    }

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      filters = readForm();
      offset = 0;
      refresh();
    });
    by('.lmt-reset').addEventListener('click', () => {
      form.reset();
      query = '';
      resetQuery?.();
      sort = '';
      direction = 'asc';
      filters = new URLSearchParams();
      offset = 0;
      refresh();
    });

    function syncOptions(control, options) {
      if (!Array.isArray(options)) return;
      const value = control.value;
      const current = [...control.options].slice(1).map(option => [option.value, option.textContent]);
      if (JSON.stringify(current) === JSON.stringify(options)) return;
      for (const option of [...control.options].slice(1)) option.remove();
      for (const [optionValue, text] of options) control.add(new Option(text, optionValue));
      control.value = [...control.options].some(option => option.value === value) ? value : '';
    }

    function applyFacets(facets) {
      if (!facets) return;
      syncOptions(fields.namedItem('region'), facets.regions?.map(region => [String(region.code), region.name + ' · ' + region.code]));
      syncOptions(fields.namedItem('activeType'), facets.activeTypes?.filter(key => activationNames[key]).map(key => [String(key), activationNames[key]]));
      syncOptions(fields.namedItem('dataType'), facets.dataTypes?.filter(key => dataNames[key]).map(key => [String(key), dataNames[key]]));
    }

    function updateSummary() {
      by('.lmt-balance span').textContent = balanceLabel;
      by('.lmt-balance strong').textContent = money(balanceRaw);
      by('.lmt-selection strong').textContent = numericText.format(selected.size);
      const total = [...selected.values()].reduce((sum, row) => sum + row.priceRaw, 0);
      by('.lmt-total strong').textContent = money(total);
      by('.lmt-clear').hidden = selected.size === 0;
      by('.lmt-pay').disabled = selected.size === 0 || typeof checkout !== 'function';
      by('.lmt-filter-currency').textContent = suppliersCurrency ? '（USD）' : '（U）';
    }

    function updateSelection() {
      const enabled = [...tbody.querySelectorAll('input[data-select]:not(:disabled)')];
      let checked = 0;
      for (const control of enabled) {
        control.checked = selected.has(control.dataset.select);
        checked += Number(control.checked);
      }
      choosePage.disabled = busy || !enabled.length;
      choosePage.checked = enabled.length > 0 && checked === enabled.length;
      choosePage.indeterminate = checked > 0 && checked < enabled.length;
      updateSummary();
    }

    function changeSelection() {
      updateSelection();
      selectedChanged?.([...selected.values()]);
    }

    function showSelectionFeedback(text = '') {
      const target = by('.lmt-selection-feedback');
      target.textContent = text;
      target.hidden = !text;
    }

    function select(plan) {
      if (!selected.has(plan.id) && selected.size >= maxSelection) return false;
      selected.set(plan.id, plan);
      return true;
    }

    choosePage.addEventListener('change', () => {
      let limitReached = false;
      for (const plan of rows.filter(plan => validPrice(plan.priceRaw))) {
        if (choosePage.checked) limitReached = !select(plan) || limitReached;
        else selected.delete(plan.id);
      }
      showSelectionFeedback(limitReached ? '一次结算最多选择 30 个套餐。' : '');
      changeSelection();
    });

    function clearSelection() {
      selected.clear();
      showSelectionFeedback();
      changeSelection();
    }
    by('.lmt-clear').addEventListener('click', clearSelection);

    function startCheckout(items) {
      if (!items.length || typeof checkout !== 'function') return;
      checkout(items, () => {
        for (const item of items) selected.delete(item.id);
        showSelectionFeedback();
        changeSelection();
      });
    }
    by('.lmt-pay').addEventListener('click', () => startCheckout([...selected.values()]));

    function markFavorite(control) {
      const favorite = favorites.has(control.dataset.favorite);
      control.setAttribute('aria-pressed', String(favorite));
      control.setAttribute('aria-label', (favorite ? '取消收藏 ' : '收藏 ') + control.dataset.planName);
      control.title = favorite ? '取消收藏' : '收藏套餐';
      control.firstElementChild.textContent = favorite ? '♥' : '♡';
    }

    function updateFavorites() {
      for (const control of tbody.querySelectorAll('button[data-favorite]')) markFavorite(control);
    }

    function openDetail(plan) {
      detail.querySelector('h3').textContent = plan.name;
      const list = detail.querySelector('dl');
      const attributes = [
        ['套餐编号', plan.slug || plan.packageCode],
        ['国家 / 地区', plan.regionName || plan.countryName || plan.location],
        ['运营商', operatorNames(plan).join(' · ')],
        ['网络', plan.speed],
        ['开始计费', activationNames[plan.activeType]],
        ['流量类型', dataNames[plan.dataType]],
        ['流量', formatVolume(plan)],
        ['有效期', formatDuration(plan)],
        ['价格', money(plan.priceRaw)],
        ['每 GB 价格', money(plan.pricePerGbRaw)],
      ];
      list.replaceChildren(...attributes.filter(([, value]) => value).map(([label, value]) => {
        const pair = node('div');
        pair.append(node('dt', label), node('dd', value));
        return pair;
      }));
      if (!detail.open) detail.showModal();
    }
    by('.lmt-close').addEventListener('click', () => detail.close());

    function renderRow(plan) {
      const row = node('tr');
      const checkCell = node('td', null, 'lmt-check');
      const check = node('input');
      check.type = 'checkbox';
      check.dataset.select = plan.id;
      check.setAttribute('aria-label', '选择 ' + plan.name);
      check.disabled = !validPrice(plan.priceRaw);
      check.addEventListener('change', () => {
        let limitReached = false;
        if (check.checked) limitReached = !select(plan);
        else selected.delete(plan.id);
        showSelectionFeedback(limitReached ? '一次结算最多选择 30 个套餐。' : '');
        changeSelection();
      });
      checkCell.append(check);

      const planCell = node('th', null, 'lmt-plan');
      planCell.scope = 'row';
      const info = node('div', null, 'lmt-plan-info');
      const name = button(plan.name, 'lmt-product', () => openDetail(plan));
      name.title = '查看套餐详情';
      const shortOperators = operatorNames(plan);
      const firstNames = shortOperators.slice(0, 2).join(' · ');
      const shortNetwork = [firstNames, plan.speed].filter(Boolean).join(' · ');
      info.append(name);
      const mobile = [formatVolume(plan), formatDuration(plan), plan.regionName || plan.countryName || plan.location].filter(Boolean);
      info.append(node('span', mobile.join(' · '), 'lmt-mobile-meta'));
      if (shortNetwork) info.append(node('span', shortNetwork, 'lmt-network'));
      const identity = node('div', null, 'lmt-plan-identity');
      identity.append(regionMark(plan), info);
      planCell.append(identity);

      const price = node('td', money(plan.priceRaw), 'lmt-price');
      const data = node('td', formatVolume(plan), 'lmt-data');
      const duration = node('td', formatDuration(plan), 'lmt-duration');
      const perGb = node('td', money(plan.pricePerGbRaw), 'lmt-unit');
      const region = node('td', plan.regionName || plan.countryName || plan.location || '—', 'lmt-place');
      const actions = node('td', null, 'lmt-actions');
      const controls = node('div', null, 'lmt-row-actions');
      const favorite = button('', 'lmt-favorite', (event) => {
        if (favorites.has(plan.id)) favorites.delete(plan.id);
        else favorites.add(plan.id);
        markFavorite(event.currentTarget);
        toggleFavorite?.(plan.id);
      });
      favorite.dataset.favorite = plan.id;
      favorite.dataset.planName = plan.name;
      favorite.disabled = typeof toggleFavorite !== 'function';
      const heart = node('span');
      heart.setAttribute('aria-hidden', 'true');
      favorite.append(heart);
      markFavorite(favorite);
      const buy = button('购买', 'lmt-buy-one', () => startCheckout([plan]));
      buy.setAttribute('aria-label', '购买 ' + plan.name);
      buy.disabled = !validPrice(plan.priceRaw) || typeof checkout !== 'function';
      controls.append(buy, favorite);
      actions.append(controls);
      row.append(checkCell, planCell, price, data, duration, perGb, region, actions);
      return row;
    }

    function setStatus(text, kind) {
      status.hidden = !text;
      status.className = 'lmt-status' + (kind === 'error' ? ' lmt-status-error' : '');
      status.replaceChildren();
      if (text) status.append(node('p', text));
      if (kind === 'error') status.append(button('重试', 'lmt-secondary', refresh));
    }

    function updateControls() {
      for (const [key, head] of controls) {
        if (sort === key) head.setAttribute('aria-sort', direction === 'asc' ? 'ascending' : 'descending');
        else head.removeAttribute('aria-sort');
      }
      mobileSort.value = sort ? sort + ':' + direction : '';
      const activeFilters = [...filters.keys()].filter(key => key !== 'dataUnit').length;
      by('.lmt-filter-count').hidden = activeFilters === 0;
      by('.lmt-filter-count').textContent = activeFilters + ' 项';
      const searchInfo = by('.lmt-query-note');
      searchInfo.hidden = !query;
      searchInfo.textContent = query ? '全局搜索 · ' + query : '';
    }

    function renderCatalog() {
      tbody.replaceChildren(...rows.map(renderRow));
      const pages = by('.lmt-pages');
      pages.hidden = count === 0;
      by('.lmt-page-range').textContent = count > 0
        ? numericText.format(offset + 1) + '–' + numericText.format(offset + rows.length) + ' / ' + numericText.format(count)
        : '';
      by('.lmt-previous').disabled = busy || offset === 0;
      by('.lmt-next').disabled = busy || !hasMore;
      const currentPage = Math.floor(offset / pageSize) + 1;
      by('.lmt-previous').setAttribute('aria-label', '上一页 · 第 ' + Math.max(1, currentPage - 1) + ' 页');
      by('.lmt-next').setAttribute('aria-label', '下一页 · 第 ' + (currentPage + 1) + ' 页');
      updateSelection();
    }

    async function refresh() {
      clearTimeout(queryTimer);
      controller?.abort();
      const request = new AbortController();
      controller = request;
      busy = true;
      root.setAttribute('aria-busy', 'true');
      by('.lmt-result-count').textContent = '正在读取套餐…';
      setStatus('正在读取套餐…');
      updateControls();
      rows = [];
      count = 0;
      hasMore = false;
      renderCatalog();
      const params = new URLSearchParams(filters);
      if (query) params.set('q', query);
      if (sort) {
        params.set('sort', sort);
        params.set('direction', direction);
      }
      params.set('facets', '1');
      params.set('offset', String(offset));
      params.set('limit', String(pageSize));
      try {
        const response = await load(params, request.signal);
        if (removed || request.signal.aborted) return;
        if (response?.connected === false || !Array.isArray(response?.items)) throw new Error('Invalid catalog');
        rows = response.items;
        count = Number.isSafeInteger(response.total) ? response.total : rows.length;
        hasMore = Boolean(response.hasMore);
        if (offset > 0 && count > 0 && rows.length === 0) {
          offset = Math.floor((count - 1) / pageSize) * pageSize;
          return refresh();
        }
        applyFacets(response.facets);
        for (const row of rows) if (selected.has(row.id)) selected.set(row.id, row);
        by('.lmt-result-count').textContent = '共 ' + numericText.format(count) + ' 个套餐';
        const empty = favoriteOnly && favorites.size === 0
          ? '还没有收藏套餐，可在资源商城收藏常用套餐。'
          : '没有符合条件的套餐，请调整筛选条件。';
        setStatus(rows.length ? '' : empty);
      } catch {
        if (removed || request.signal.aborted) return;
        by('.lmt-result-count').textContent = '加载失败';
        setStatus('暂时无法加载套餐，请重试。', 'error');
      }
      if (removed || request.signal.aborted) return;
      busy = false;
      root.removeAttribute('aria-busy');
      renderCatalog();
    }

    by('.lmt-previous').addEventListener('click', () => {
      offset = Math.max(0, offset - pageSize);
      by('.lmt-results-head h2').focus();
      refresh();
    });
    by('.lmt-next').addEventListener('click', () => {
      offset += pageSize;
      by('.lmt-results-head h2').focus();
      refresh();
    });

    return {
      update(options = {}) {
        const nextScope = options.scopeKey ?? scopeKey;
        const nextQuery = options.query ?? query;
        const scopeChanged = initial || nextScope !== scopeKey;
        const queryChanged = nextQuery !== query;
        initial = false;
        scopeKey = nextScope;
        query = nextQuery;
        const oldCurrency = suppliersCurrency;
        if (options.currency !== undefined) suppliersCurrency = options.currency === 'USD';
        if (options.balanceLabel !== undefined) balanceLabel = options.balanceLabel || '可用余额';
        if ('balanceRaw' in options) balanceRaw = options.balanceRaw;
        if (options.scopeLabel) by('.lmt-results-head h2').textContent = options.scopeLabel;
        if (options.favoriteOnly !== undefined) favoriteOnly = options.favoriteOnly;
        if (options.favoriteIds) favorites = new Set(options.favoriteIds);
        if (options.selectedItems) selected = new Map(options.selectedItems.slice(0, maxSelection).map(row => [row.id, row]));
        if (scopeChanged) {
          offset = 0;
          refresh();
        } else if (queryChanged) {
          offset = 0;
          controller?.abort();
          clearTimeout(queryTimer);
          queryTimer = setTimeout(refresh, 160);
        } else if (oldCurrency !== suppliersCurrency) {
          renderCatalog();
        } else {
          updateFavorites();
          updateSelection();
        }
      },
      clearSelection,
      destroy() {
        removed = true;
        clearTimeout(queryTimer);
        controller?.abort();
        root.remove();
      },
    };
  }

  window.LumenMarketTable = Object.freeze({ mount });
})();
