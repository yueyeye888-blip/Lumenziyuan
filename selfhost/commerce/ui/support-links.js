(() => {
  const inboxPath = '/__host/support';
  const order = /^\/address-orders\/(ADDR-[\dA-Z-]+)\/?$/.exec(location.pathname)?.[1] || '';
  const selected = location.pathname === inboxPath ? new URLSearchParams(location.search).get('ticket') : null;
  const inFrame = window.self !== window.top;
  const root = document.createElement('div');
  root.className = 'yorke-support';
  root.innerHTML = `
    <button type="button" class="support-launch" aria-haspopup="dialog"><span class="support-chat-icon" aria-hidden="true"></span><span>客服</span></button>
    <dialog class="support-panel" aria-labelledby="support-title">
      <header><div><strong>Yorke AI</strong><h2 id="support-title">客服中心</h2></div>
        <button type="button" class="support-close" aria-label="关闭">×</button></header>
      <div class="support-body">
        <p class="support-feedback" role="status" hidden></p>
        <div class="support-content"></div>
      </div>
      <footer><a href="https://t.me/YorkeYue" target="_blank" rel="noopener noreferrer">Telegram @YorkeYue</a>
        <a href="${inboxPath}">查看工单</a></footer>
    </dialog>`;
  document.body.append(root);
  const dialog = root.querySelector('dialog');
  const content = root.querySelector('.support-content');
  const feedback = root.querySelector('.support-feedback');
  const bell = document.createElement('button');
  bell.type = 'button';
  bell.className = 'support-bell';
  bell.setAttribute('aria-label','客服通知');
  bell.setAttribute('aria-haspopup','dialog');
  bell.innerHTML = '<span class="support-bell-icon" aria-hidden="true"></span><span class="support-unread" hidden></span>';
  bell.hidden = true;
  const badge = bell.lastElementChild;

  let active = '';
  let notificationRequest;
  function feedbackText(message) {
    feedback.textContent = message;
    feedback.hidden = !message;
  }
  function make(tag, value, className) {
    const element = document.createElement(tag);
    if (value) element.textContent = value;
    if (className) element.className = className;
    return element;
  }
  function time(milliseconds) {
    const locale = window.LumenLocale?.language === 'zh' ? 'zh-CN' : 'en-GB';
    return new Intl.DateTimeFormat(locale, { timeZone:'Asia/Singapore', dateStyle:'medium', timeStyle:'short' }).format(milliseconds);
  }
  function userText(tag, value) {
    const element = make(tag,value,'support-user-text');
    element.setAttribute('data-lumen-no-translate','');
    return element;
  }
  async function request(params, fields) {
    const response = await fetch('/api/support' + (params ? '?' + params.toString() : ''), {
      cache:'no-store',
      signal:AbortSignal.timeout(10_000),
      ...(fields ? { method:'POST', body:new URLSearchParams(fields) } : {}),
    });
    if (response.status === 401) return null;
    const data = await response.json();
    if (!response.ok) throw Error(data.error || '客服暂时不可用。');
    return data;
  }
  function badgeState(data) {
    const toolbar = document.querySelector('.lumen-locale-picker');
    if (inFrame || !toolbar) return;
    if (!bell.isConnected) toolbar.append(bell);
    bell.hidden = !data?.owner;
    badge.hidden = !data?.unread;
    badge.textContent = data?.unread > 99 ? '99+' : String(data?.unread || '');
  }
  function refreshBadge() {
    if (inFrame || notificationRequest || document.hidden) return;
    notificationRequest = request(new URLSearchParams({summary:'1'})).then(badgeState).catch(() => {}).finally(() => { notificationRequest = null; });
  }
  function formKey() {
    return crypto.randomUUID();
  }
  function renderComposer() {
    const form = make('form');
    form.innerHTML = `<label>类型<select name="kind">
      <option value="message">客服消息</option><option value="ticket">提交工单</option>
      </select></label>
      <label>订单号（选填）<input name="order" maxlength="100"></label>
      <label>问题描述<textarea name="message" required maxlength="2000" rows="4" placeholder="请简述你遇到的问题"></textarea></label>
      <button type="submit" class="support-primary">发送</button>`;
    form.elements.order.value = order;
    let id = formKey();
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const button = form.querySelector('button');
      button.disabled = true;
      feedbackText('');
      try {
        const data = await request(null, { action:'create', id, ...Object.fromEntries(new FormData(form)) });
        if (!data) throw Error('请先登录后再发送。');
        badgeState(data);
        form.elements.message.value = '';
        id = formKey();
        feedbackText('已发送，可在客服中心查看回复。');
      } catch (error) { feedbackText(error.message); }
      finally { button.disabled = false; }
    });
    content.replaceChildren(form);
  }
  function showTicket(ticket) {
    const section = make('section',null,'support-thread');
    const back = make('button','返回消息列表','support-back');
    back.type = 'button';
    back.addEventListener('click', () => void showInbox());
    const label = ticket.kind === 'message' ? '客服消息' : '工单';
    section.append(back,make('h3',label+' #'+ticket.id.slice(0,8).toUpperCase()), make('small',time(ticket.createdAt)));
    if (ticket.email) section.append(userText('p',ticket.email));
    if (ticket.orderRef) section.append(userText('p',ticket.orderRef));
    section.append(userText('p',ticket.message));
    if (ticket.reply) {
      section.append(make('h3','客服回复'),userText('p',ticket.reply));
    } else {
      const form = make('form');
      form.innerHTML = '<label>回复<textarea name="reply" required maxlength="2000" rows="3"></textarea></label><button class="support-primary">发送回复</button>';
      form.addEventListener('submit', async event => {
        event.preventDefault();
        const button = form.querySelector('button');
        button.disabled = true;
        feedbackText('');
        try {
          const updated = await request(new URLSearchParams({ticket:ticket.id}),{action:'reply',id:ticket.id,reply:form.elements.reply.value});
          if (!updated?.owner) throw Error('请重新登录。');
          badgeState(updated);
          const saved = updated.tickets.find(item => item.id === ticket.id);
          if (saved) showTicket(saved);
        } catch (error) { feedbackText(error.message); }
        finally { button.disabled = false; }
      });
      section.append(form);
    }
    content.replaceChildren(section);
    if (ticket.unread) void request(new URLSearchParams({summary:'1'}),{action:'read',id:ticket.id}).then(badgeState).catch(() => {});
  }
  async function showInbox(ticketId) {
    feedbackText('');
    content.replaceChildren(make('p','正在加载…'));
    try {
      const data = await request(ticketId ? new URLSearchParams({ticket:ticketId}) : null);
      if (!dialog.open || active !== 'inbox') return;
      if (!data?.owner) throw Error('仅平台所有者可以查看客服通知。');
      badgeState(data);
      const ticket = data.tickets.find(item => item.id === ticketId);
      if (ticket) { showTicket(ticket); return; }
      const list = make('ul',null,'support-inbox');
      for (const item of data.tickets) {
        const row = make('li');
        const button = make('button',null,'support-inbox-row');
        button.type = 'button';
        const kind = item.kind === 'message' ? '客服消息' : '工单';
        button.append(make('strong',kind),make('small',time(item.createdAt)),userText('span',item.message));
        if (item.unread) button.append(make('i','未读','support-dot'));
        button.addEventListener('click', () => showTicket(item));
        row.append(button);
        list.append(row);
      }
      content.replaceChildren(data.tickets.length ? list : make('p','暂无客服消息。'));
    } catch (error) {
      content.replaceChildren();
      feedbackText(error.message);
    }
  }
  function open(mode, ticketId) {
    active = mode;
    dialog.querySelector('h2').textContent = mode==='inbox'?'客服通知':'客服中心';
    if (!dialog.open) dialog.showModal();
    feedbackText('');
    if (mode==='inbox') void showInbox(ticketId);
    else {
      content.replaceChildren(make('p','正在加载…'));
      void request(new URLSearchParams({summary:'1'})).then(data => {
      if (!dialog.open || active !== mode) return;
      if (data) { renderComposer(); return; }
      const login = make('a','登录后发送消息','support-primary');
      login.href = '/__host/login?returnTo='+encodeURIComponent(inboxPath+(order?'?order='+order:''));
      content.replaceChildren(login);
      }).catch(() => { content.replaceChildren(); feedbackText('客服暂时不可用。'); });
    }
  }
  root.querySelector('.support-launch').hidden = inFrame;
  root.querySelector('.support-launch').addEventListener('click', () => open('composer'));
  root.querySelector('.support-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  bell.addEventListener('click', () => open('inbox'));

  function attachModalLinks() {
    for (const modal of document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"]')) {
      if (modal===dialog || modal.querySelector('.support-payment-link')) continue;
      const button = make('button','联系客服','support-payment-link');
      button.type = 'button';
      button.addEventListener('click', () => open('composer'));
      modal.append(button);
    }
  }
  let scheduled = false;
  new MutationObserver(() => {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(() => { scheduled = false; attachModalLinks(); });
    }
  }).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open','aria-modal']});
  attachModalLinks();
  refreshBadge();
  window.addEventListener('yorke:toolbar-ready',refreshBadge);
  document.addEventListener('visibilitychange',refreshBadge);
  setInterval(refreshBadge,15_000);
  if (selected && !inFrame) open('inbox',selected);
})();
