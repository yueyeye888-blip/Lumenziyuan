(() => {
  const form = document.getElementById('create-employee');
  const requestJson = async (path, options) => {
    const response = await fetch(path, {cache:'no-store', ...options});
    const data = await response.json();
    if (!response.ok) throw Error(data.error || '操作失败');
    return data;
  };
  const element = (tag, text) => {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
  };
  if (form) {
    const select = (id) => document.getElementById(id);
    const list = select('account-list');
    const status = select('account-status');
    const search = select('account-search');
    const empty = select('empty-accounts');
    const toolbar = select('new-employee');
    const credit = select('credit-form');
    const discount = select('discount-form');
    const discountMode = discount.elements.mode;
    const discountPercent = discount.elements.percent;
    const percentLabel = (value) => units.format(value / 100) + '%';
    const hasDiscount = (account) => Number.isInteger(account.discountBps);
    const summary = new Intl.NumberFormat('en-US');
    const units = new Intl.NumberFormat('en-US', {maximumFractionDigits: 4});
    const amount = (raw) => units.format(raw / 10000);
    const money = (raw) => amount(raw) + ' U';
    const roles = {admin: '管理员', employee: '合伙人', customer: '平台用户'};
    let accounts, role = 'employee', target, discountTarget;

    function notice(message, failure = false) {
      status.textContent = message;
      status.classList.toggle('problem', failure);
      status.hidden = !message;
    }

    function show(dialog) {
      dialog.querySelector('.modal-feedback').hidden = true;
      dialog.showModal();
      dialog.querySelector('input, select').focus();
    }

    function openCredit(account) {
      target = account;
      credit.reset();
      select('credit-account').replaceChildren(element('strong', account.name || account.email), element('small', account.email));
      select('credit-before').textContent = money(account.availableRaw);
      select('credit-result').textContent = '—';
      show(select('credit-dialog'));
    }

    function syncDiscountFields() {
      const isAgent = discountMode.value === 'agent';
      select('discount-fields').hidden = !isAgent;
      discountPercent.disabled = !isAgent;
      discountPercent.required = isAgent;
    }

    function openDiscount(account) {
      discountTarget = account;
      discount.reset();
      discountMode.value = hasDiscount(account) ? 'agent' : 'standard';
      discountPercent.value = hasDiscount(account) ? account.discountBps / 100 : '80';
      select('discount-account').replaceChildren(element('strong', account.name || account.email), element('small', account.email));
      syncDiscountFields();
      show(select('discount-dialog'));
    }

    function render() {
      if (!accounts) return;
      const query = search.value.trim().toLowerCase();
      const matches = accounts.filter(account => (role === 'all' || (role === 'agent' ? hasDiscount(account) : account.role === role)) &&
        (account.email + ' ' + account.name).toLowerCase().includes(query));
      list.replaceChildren();
      for (const account of matches) {
        const row = list.insertRow();
        row.setAttribute('role', 'row');
        const name = account.name || account.email;
        const identity = element('div', '');
        identity.className = 'identity';
        const avatar = element('span', Array.from(name)[0].toUpperCase());
        avatar.className = 'initial';
        avatar.setAttribute('aria-hidden', 'true');
        const identityText = element('div', '');
        identityText.append(element('strong', name), element('small', account.email));
        identity.append(avatar, identityText);
        row.insertCell().append(identity);

        const badge = element('span', roles[account.role]);
        badge.className = 'role role-' + account.role;
        const identityRoles = row.insertCell();
        identityRoles.className = 'account-roles';
        identityRoles.append(badge);
        if (hasDiscount(account)) {
          const agentBadge = element('span', '代理 · ' + percentLabel(account.discountBps));
          agentBadge.className = 'role role-agent';
          identityRoles.append(agentBadge);
        }

        const balance = row.insertCell();
        const currency = element('span', 'U');
        currency.className = 'unit';
        balance.className = 'balance';
        balance.append(amount(account.availableRaw), ' ', currency);

        const action = row.insertCell();
        action.className = 'account-action';
        if (account.enabled) {
          const button = element('button', '增加额度');
          button.type = 'button';
          button.className = 'button neutral';
          button.setAttribute('aria-label', '增加额度 · ' + account.email);
          button.onclick = () => openCredit(account);
          action.append(button);
          if (account.role !== 'admin') {
            const agentAction = element('button', hasDiscount(account) ? '修改折扣' : '设置代理');
            agentAction.type = 'button';
            agentAction.className = 'button neutral';
            agentAction.setAttribute('aria-label', agentAction.textContent + ' · ' + account.email);
            agentAction.onclick = () => openDiscount(account);
            action.append(agentAction);
          }
        } else {
          const stopped = element('span', '已停用');
          stopped.className = 'unavailable';
          action.append(stopped);
        }
      }
      select('account-count').textContent = summary.format(matches.length);
      empty.hidden = Boolean(matches.length);
      empty.textContent = query ? '未找到匹配的账号。' : {
        all: '暂无账号。',
        employee: '暂无合伙人。点击「创建合伙人」添加第一个账号。',
        customer: '暂无通过邮箱注册的平台用户。',
        agent: '暂无代理。在合伙人或平台用户的账号旁点击「设置代理」。',
      }[role];
    }

    async function refresh() {
      accounts = (await requestJson('/api/operations/accounts')).accounts;
      const employees = accounts.filter(account => account.role === 'employee');
      select('employee-count').textContent = summary.format(employees.length);
      select('agent-count').textContent = summary.format(accounts.filter(hasDiscount).length);
      select('customer-count').textContent = summary.format(accounts.filter(account => account.role === 'customer').length);
      select('employee-balance').textContent = amount(employees.reduce((total, account) => total + account.availableRaw, 0));
      render();
    }

    function selectTab(next) {
      role = next;
      for (const button of document.querySelectorAll('[data-role]')) {
        button.setAttribute('aria-pressed', String(button.dataset.role === next));
      }
      render();
    }

    for (const button of document.querySelectorAll('[data-role]')) button.onclick = () => selectTab(button.dataset.role);
    search.oninput = render;
    discountMode.onchange = syncDiscountFields;
    toolbar.onclick = () => {
      form.reset();
      show(select('employee-dialog'));
    };
    document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => select(button.dataset.close).close());

    function onSubmit(formEl, pending, action) {
      const dialog = formEl.closest('dialog');
      const submit = formEl.querySelector('button[type="submit"]');
      const closeButtons = dialog.querySelectorAll('[data-close]');
      const feedback = formEl.querySelector('.modal-feedback');
      const label = submit.textContent;
      formEl.addEventListener('submit', async (event) => {
        event.preventDefault();
        const fields = Object.fromEntries(new FormData(formEl));
        feedback.hidden = true;
        submit.disabled = true;
        submit.textContent = pending;
        closeButtons.forEach(button => button.disabled = true);
        try {
          const message = await action(fields);
          dialog.close();
          formEl.reset();
          notice(message);
          await refresh();
        } catch (error) {
          if (dialog.open) {
            feedback.textContent = error.message;
            feedback.hidden = false;
          } else {
            notice(status.textContent + ' 目录刷新失败，请刷新页面。', true);
          }
        } finally {
          submit.disabled = false;
          submit.textContent = label;
          closeButtons.forEach(button => button.disabled = false);
        }
      });
      dialog.addEventListener('cancel', event => {
        if (submit.disabled) event.preventDefault();
      });
    }

    const post = (url, data) => requestJson(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)});
    onSubmit(form, '正在创建…', async fields => {
      await post('/api/operations/accounts', fields);
      search.value = '';
      selectTab('employee');
      return '已创建合伙人账号 ' + fields.email + '。';
    });
    credit.elements.amount.oninput = () => {
      const delta = Math.round(Number(credit.elements.amount.value) * 10000);
      select('credit-result').textContent = credit.elements.amount.validity.valid && delta > 0
        ? money(target.availableRaw + delta) : '—';
    };
    onSubmit(credit, '正在入账…', async fields => {
      const key = 'lumen:admin-credit:' + JSON.stringify([target.email, fields.amount, fields.note]);
      const requestId = sessionStorage.getItem(key) || crypto.randomUUID();
      sessionStorage.setItem(key, requestId);
      const data = await post('/api/commerce/admin/credit', {...fields, email: target.email, requestId});
      sessionStorage.removeItem(key);
      return data.email + ' 的可用余额已更新为 ' + money(data.availableRaw) + '。';
    });

    onSubmit(discount, '正在保存…', async fields => {
      const discountBps = fields.mode === 'agent' ? Math.round(Number(fields.percent) * 100) : null;
      const saved = await post('/api/operations/accounts/discount', { email: discountTarget.email, discountBps });
      return saved.discountBps === null
        ? saved.email + ' 已恢复普通定价。'
        : saved.email + ' 已设置为代理，按零售价的 ' + percentLabel(saved.discountBps) + ' 支付。';
    });

    refresh().then(() => {
      const email = new URL(location.href).searchParams.get('credit');
      const account = email && accounts.find(entry => entry.enabled && entry.email.toLowerCase() === email.toLowerCase());
      if (account) {
        selectTab(account.role === 'admin' ? 'all' : account.role);
        openCredit(account);
      }
    }).catch(error => { empty.textContent = error.message; });
    return;
  }

  const selection = () => [...document.querySelectorAll('tr[data-lumen-esim-id]')]
    .filter(row => row.querySelector('input[type=checkbox]')?.checked)
    .map(row => row.dataset.lumenEsimId);

  async function exportSelection(button, info) {
    const ids = selection();
    if (!ids.length) { info.textContent = '请先在当前列表勾选要导出的资源。'; return; }
    button.disabled = true;
    info.textContent = `正在整理 ${ids.length} 张 eSIM 的二维码…`;
    try {
      const response = await fetch('/api/esim/export', {mode:'same-origin',method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids}),signal:AbortSignal.timeout(180_000)});
      if (!response.ok) throw Error((await response.json()).error || '导出失败');
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = 'Lumen-eSIM-' + new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Singapore'}).format(new Date()) + '.xlsx';
      link.click();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      const embedded = Number(response.headers.get('x-lumen-qr-count'));
      info.textContent = embedded === ids.length ? `已导出 ${ids.length} 张 eSIM。` : `已导出 ${ids.length} 张 eSIM，${ids.length - embedded} 张未能载入二维码。`;
    } catch (error) { info.textContent = error.message || '导出失败，请重试。'; }
    finally { button.disabled = false; }
  }

  const buttonStyle = 'display:inline-flex;align-items:center;justify-content:center;border:1px solid #cbd9eb;border-radius:11px;padding:9px 14px;min-height:38px;background:white;color:#1d3b72;font:600 13px system-ui;text-decoration:none;white-space:nowrap;cursor:pointer';
  const primaryStyle = buttonStyle + ';background:#1d3b72;color:white;border-color:#1d3b72';

  function openEmailDialog(info) {
    const ids = selection();
    if (!ids.length) { info.textContent = '请先在当前列表勾选要发送的资源。'; return; }
    const dialog = document.createElement('dialog');
    dialog.style.cssText = 'width:min(440px,calc(100vw - 32px));max-height:90vh;overflow:auto;margin:auto;padding:24px;border:1px solid #dbe4f0;border-radius:18px;background:white;color:#243d64;box-shadow:0 0 0 100vmax #0c204a75,0 20px 60px #1d3b722e';
    dialog.setAttribute('aria-labelledby','lumen-email-title');
    const emailForm = document.createElement('form');
    emailForm.autocomplete = 'off';
    const title = element('h2','发送邮箱');
    title.id = 'lumen-email-title';
    title.style.cssText = 'margin:0;font-size:20px;font-weight:650';
    const description = element('p',`将所选 ${ids.length} 张 eSIM 的二维码作为 Excel 附件发送。`);
    const sender = element('p','发件人  ·  站点已授权的 Outlook 邮箱');
    for (const paragraph of [description,sender]) paragraph.style.cssText = 'margin-top:8px;color:#5a7093;font-size:13px;line-height:1.5';
    const label = element('label','收件邮箱');
    label.style.cssText = 'display:block;margin-top:18px;font-size:13px;font-weight:600';
    const recipient = document.createElement('input');
    recipient.type = 'email'; recipient.required = true; recipient.maxLength = 254; recipient.autocomplete = 'off';
    recipient.placeholder = '请输入收件邮箱';
    recipient.style.cssText = 'display:block;width:100%;min-height:42px;margin-top:7px;padding:9px 12px;border:1px solid #cbd9eb;border-radius:9px;background:white;color:#243d64;font-size:14px';
    label.append(recipient);
    const feedback = element('p','');
    feedback.role = 'status'; feedback.style.cssText = 'margin-top:10px;color:#5a7093;font-size:13px;line-height:1.5';
    const actions = document.createElement('div'); actions.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:18px';
    const cancel = element('button','取消'); cancel.type = 'button'; cancel.style.cssText = buttonStyle;
    const send = element('button','发送 Excel'); send.type = 'submit'; send.style.cssText = primaryStyle;
    actions.append(cancel,send);
    emailForm.append(title,description,sender,label,feedback,actions);
    dialog.append(emailForm); document.body.append(dialog);

    let requestId = crypto.randomUUID();
    let sending = false;
    cancel.addEventListener('click',() => dialog.close());
    dialog.addEventListener('cancel',event => { if (sending) event.preventDefault(); });
    dialog.addEventListener('close',() => dialog.remove(),{once:true});
    emailForm.addEventListener('submit',async event => {
      event.preventDefault();
      if (sending) return;
      sending = true; cancel.disabled = send.disabled = recipient.readOnly = true;
      send.textContent = '正在发送…'; feedback.textContent = '正在整理 Excel 并提交给 Outlook。';
      try {
        const response = await fetch('/api/esim/email', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids,recipient:recipient.value.trim(),requestId}),signal:AbortSignal.timeout(180_000)});
        if (response.status === 401) { feedback.textContent = '登录已失效，请重新登录后查看邮件交付记录。'; return; }
        const result = await response.json();
        if (response.ok && result.status === 'accepted') {
          const missing = result.count - result.embedded;
          info.textContent = `Outlook 已接受发往 ${result.recipient} 的邮件，附件含 ${result.embedded} 张二维码。${missing ? `另有 ${missing} 张暂未取得二维码。` : ''}`;
          dialog.close(); return;
        }
        feedback.textContent = result.error || '发送结果待确认，请查看邮件交付记录。';
        if (result.status === 'unknown') { send.hidden = true; cancel.textContent = '关闭'; }
        else if (response.status !== 429) { recipient.readOnly = false; requestId = crypto.randomUUID(); }
      } catch {
        feedback.textContent = '连接中断。可用相同收件邮箱再次点击以查询本次结果，或先查看邮件交付记录。';
      } finally { sending = false; cancel.disabled = send.disabled = false; send.textContent = '发送 Excel'; }
    });
    dialog.showModal(); recipient.focus();
  }

  const processed = new WeakSet();
  function enhance() {
    for (const heading of document.querySelectorAll('h1,h2')) {
      if (processed.has(heading)) continue;
      switch ((window.LumenLocale?.originalText(heading) ?? heading.textContent).trim()) {
        case '已购买产品与交付信息': {
          const button = element('button','导出二维码 Excel');
          button.type = 'button'; button.style.cssText = buttonStyle; button.title = '导出当前筛选结果中已勾选的资源';
          const info = element('p',''); info.role = 'status'; info.style.cssText = 'font-size:12px;color:#5a7093';
          button.addEventListener('click',() => void exportSelection(button,info));
          const email = element('button','发送邮箱'); email.type = 'button'; email.style.cssText = primaryStyle;
          email.addEventListener('click',() => openEmailDialog(info));
          const actions = document.createElement('div'); actions.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:12px';
          actions.append(button,email,info); heading.parentElement.append(actions);
          processed.add(heading); break;
        }
        case 'Telegram 资源提醒': {
          const message = element('p','正在读取定时检查状态…'); message.style.cssText = 'font-size:12px;color:#637b9d;margin-top:8px';
          heading.parentElement.parentElement.append(message); processed.add(heading);
          const update = () => requestJson('/api/operations/reminders').then(state => {
            const next = new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Singapore',dateStyle:'short',timeStyle:'short'}).format(new Date(state.nextCheckAt));
            message.textContent = state.error || `每 ${state.everyMinutes} 分钟检查一次 · ${state.lastCheckedAt ? `上次匹配 ${state.matched} 项 · ` : ''}下次 ${next}（新加坡时间）`;
          }).catch(() => { message.textContent = '暂时无法读取定时检查状态'; });
          void update(); break;
        }
      }
    }
  }
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; enhance(); });
  }).observe(document.body,{childList:true,subtree:true});
  enhance();
})();
