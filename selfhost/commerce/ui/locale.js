(() => {
  const key = 'lumen.ui.language';
  const han = /\p{Script=Han}/u;
  const localizedAttributes = ['aria-label', 'aria-description', 'placeholder', 'title', 'alt', 'data-label'];
  const blocked = 'script, style, noscript, template, code, pre, [contenteditable]:not([contenteditable=false]), [data-lumen-no-translate]';
  const normalize = (value) => value.trim().replace(/\s+/g, ' ');
  const text = new WeakMap();
  const attrs = new WeakMap();
  const roots = new Set();
  const pending = new Set();
  let language = 'en';
  let scheduled = false;
  let started = false;
  let picker;
  const dictionary = new Map();
  const exact = {...window.LumenLocaleData, ...window.LumenLocaleExtra, ...window.LumenLocaleMarket};
  if (typeof Intl.DisplayNames === 'function') {
    const chinese = new Intl.DisplayNames(['zh-CN'], { type: 'region', fallback: 'none' });
    const english = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
    for (const a of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      for (const b of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
        const source = chinese.of(a + b);
        const target = english.of(a + b);
        if (source && target) dictionary.set(source, target);
      }
    }
  }
  for (const [source, target] of Object.entries(exact)) {
    if (typeof target === 'string') dictionary.set(normalize(source), target);
  }

  const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = Object.entries(window.LumenLocalePatterns || {}).map(([source, target]) => {
    const parts = source.split(/(\{\d+\})/);
    const slots = [];
    const regex = parts.map((part) => {
      const match = /^\{(\d+)\}$/.exec(part);
      if (!match) return escapeRegExp(part);
      slots.push(Number(match[1]));
      return '(.+?)';
    }).join('');
    return {
      expression: new RegExp('^' + regex + '$'),
      render(match) {
        return target.replace(/\{(\d+)\}/g, (_, index) => {
          const captured = match[slots.indexOf(Number(index)) + 1] ?? '';
          return dictionary.get(captured) ?? captured;
        });
      },
    };
  });

  try {
    const saved = localStorage.getItem(key);
    if (saved === 'zh' || saved === 'en') language = saved;
  } catch {}

  function inEnglish(value) {
    const input = normalize(value);
    const direct = dictionary.get(input);
    if (direct !== undefined) return direct;
    const withFlag = /^(.*?) (\p{Regional_Indicator}{2})$/u.exec(input);
    if (withFlag && dictionary.has(withFlag[1])) return dictionary.get(withFlag[1]) + ' ' + withFlag[2];
    for (const pattern of patterns) {
      const match = pattern.expression.exec(input);
      if (match) return pattern.render(match);
    }
    for (const [expression, target] of window.LumenLocaleExtraPatterns || []) {
      expression.lastIndex = 0;
      if (expression.test(input)) {
        expression.lastIndex = 0;
        return input.replace(expression, target);
      }
    }
    // Keep provider names and values intact when only a label within a segmented
    // summary needs translation, such as “Email · Outlook”.
    if (input.includes(' · ')) {
      const parts = input.split(' · ');
      const result = parts.map((part) => dictionary.get(part) ?? part);
      if (result.some((part, index) => part !== parts[index])) return result.join(' · ');
    }
    return input;
  }

  function translate(value) {
    if (language !== 'en' || typeof value !== 'string' || !han.test(value)) return value;
    const output = inEnglish(value);
    if (output === normalize(value)) return value;
    return value.match(/^\s*/)[0] + output + value.match(/\s*$/)[0];
  }

  function sourceValue(current, old) {
    return old && old.rendered === current ? old.source : current;
  }

  function originalText(node) {
    if (!node) return '';
    if (node.nodeType === 3) return sourceValue(node.data, text.get(node));
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let result = '';
    for (let child = walker.nextNode(); child; child = walker.nextNode()) result += originalText(child);
    return result;
  }

  function originalAttribute(element, name) {
    const current = element?.getAttribute(name);
    return sourceValue(current, attrs.get(element)?.get(name));
  }

  function renderText(node) {
    const parent = node.parentElement;
    if (!parent || parent.closest(blocked)) return;
    const source = sourceValue(node.data, text.get(node));
    const rendered = translate(source);
    if (source === rendered && source === node.data) return;
    // Some select options derive their submitted value from visible text.
    if (parent.tagName === 'OPTION' && !parent.hasAttribute('value')) parent.value = source.trim();
    text.set(node, { source, rendered });
    if (node.data !== rendered) node.data = rendered;
  }

  function renderAttribute(element, name, values) {
    const current = element.getAttribute(name);
    if (current === null) {
      values.delete(name);
      return;
    }
    const source = sourceValue(current, values.get(name));
    const rendered = translate(source);
    if (current === rendered && source === rendered) return;
    values.set(name, { source, rendered });
    if (current !== rendered) element.setAttribute(name, rendered);
  }

  function renderElement(element) {
    if (element.closest(blocked)) return;
    let values = attrs.get(element);
    if (!values) {
      values = new Map();
      attrs.set(element, values);
    }
    for (const name of localizedAttributes) renderAttribute(element, name, values);
    if (element.matches('input[type=button], input[type=submit], input[type=reset]')) renderAttribute(element, 'value', values);
    if (element.shadowRoot) watch(element.shadowRoot);
  }

  function scan(node) {
    if (node.nodeType === 3) return renderText(node);
    if (node.nodeType === 1) renderElement(node);
    if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11) return;
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(element) {
        return element.nodeType === 1 && element.matches(blocked) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });
    for (let child = walker.nextNode(); child; child = walker.nextNode()) {
      if (child.nodeType === 1) renderElement(child);
      else renderText(child);
    }
  }

  function flush() {
    scheduled = false;
    for (const node of pending) {
      if (node.isConnected || node === document) scan(node);
    }
    pending.clear();
    if (picker && !picker.isConnected) document.body.append(picker);
  }

  function schedule(node) {
    pending.add(node);
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(flush);
    }
  }

  const observer = new MutationObserver((changes) => {
    for (const change of changes) {
      if (change.type === 'childList') {
        change.addedNodes.forEach(schedule);
        if (picker && !picker.isConnected) schedule(document);
      } else {
        schedule(change.target);
      }
    }
  });

  function watch(root) {
    if (!roots.has(root)) {
      roots.add(root);
      observer.observe(root, {
        subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...localizedAttributes, 'value'],
      });
      scan(root);
    }
  }

  function attachShadowRoots() {
    const original = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (options) {
      const result = original.call(this, options);
      if (options.mode === 'open' && started) watch(result);
      return result;
    };
  }

  function updateLanguage(next, save) {
    if (next !== 'en' && next !== 'zh') return;
    const changed = language !== next;
    language = next;
    if (save) {
      try { localStorage.setItem(key, next); } catch {}
    }
    document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
    for (const button of picker?.querySelectorAll('button') || []) button.setAttribute('aria-pressed', String(button.dataset.language === language));
    if (started) {
      for (const root of roots) {
        if (root !== document && !root.host?.isConnected) roots.delete(root);
        else schedule(root);
      }
    }
    if (changed) window.dispatchEvent(new CustomEvent('lumen:locale-change', { detail: { language } }));
  }

  function buildPicker() {
    if (window.self !== window.top) return;
    picker = document.createElement('div');
    picker.className = 'lumen-locale-picker';
    picker.setAttribute('role', 'group');
    picker.setAttribute('aria-label', 'Language / 语言');
    picker.setAttribute('data-lumen-no-translate', '');
    for (const [code, label, description] of [['en', 'EN', 'English'], ['zh', '中文', '简体中文']]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.language = code;
      button.textContent = label;
      button.title = description;
      button.setAttribute('aria-label', description);
      button.addEventListener('click', () => updateLanguage(code, true));
      picker.append(button);
    }
    document.body.append(picker);
  }

  function start() {
    if (started) return;
    started = true;
    buildPicker();
    updateLanguage(language);
    watch(document);
  }

  window.LumenLocale = Object.freeze({
    t: translate,
    originalText,
    originalAttribute,
    get language() { return language; },
    setLanguage(next) { updateLanguage(next, true); },
  });
  window.addEventListener('storage', (event) => {
    if (event.key === key) updateLanguage(event.newValue);
  });
  for (const name of ['alert', 'confirm', 'prompt']) {
    const open = window[name];
    window[name] = (message, ...args) => open.call(window, translate(message), ...args);
  }
  attachShadowRoots();

  const appRoute = location.pathname === '/' || location.pathname === '/mail-delivery' || location.pathname.startsWith('/address-orders/');
  if (appRoute) {
    // These routes opt into React hydration. The first page-specific effect
    // requests data after hydration, so text updates never change the SSR DOM first.
    const ready = (entry) => {
      const { pathname } = new URL(entry.name);
      return pathname === '/api/session' || pathname === '/api/mail-deliveries' || pathname.startsWith('/api/address-orders/');
    };
    if (performance.getEntriesByType('resource').some(ready)) start();
    else if (window.PerformanceObserver?.supportedEntryTypes?.includes('resource')) {
      const resources = new PerformanceObserver((list) => {
        if (list.getEntries().some(ready)) {
          resources.disconnect();
          start();
        }
      });
      resources.observe({ type: 'resource', buffered: true });
    }
    if (document.readyState === 'complete') setTimeout(start, 1700);
    else window.addEventListener('load', () => setTimeout(start, 1700), { once: true });
  } else if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
