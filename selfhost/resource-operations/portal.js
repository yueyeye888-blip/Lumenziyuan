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
    const credit = select('credit-form');
    const amount = (raw) => (raw / 10000).toLocaleString('en-US', {maximumFractionDigits:4}) + ' U';
    let accounts = [], role = 'employee', target;
    function show(dialog) {
      dialog.querySelector('.modal-feedback').hidden = true;
      dialog.showModal();
      dialog.querySelector('input').focus();
    }
    function openCredit(account) {
      target = account;
      credit.reset();
      select('credit-account').textContent = (account.name || account.email) + ' · ' + account.email;
      select('credit-result').textContent = '当前可用余额 ' + amount(account.availableRaw);
      show(select('credit-dialog'));
    }
    function render() {
      const query = select('account-search').value.trim().toLowerCase();
      const matches = accounts.filter(a => (role==='all' || a.role === role) &&
        (a.email+' '+a.name).toLowerCase().includes(query));
      list.replaceChildren();
      for (const a of matches) {
        const row = list.insertRow(), identity = row.insertCell();
        identity.append(element('strong',a.name || a.email), element('small',a.email));
        row.insertCell().textContent = ({admin:'管理员',employee:'员工',customer:'平台用户'})[a.role] + (a.enabled ? '' : '（停用）');
        row.insertCell().textContent = amount(a.availableRaw);
        const action = row.insertCell();
        if (a.enabled) {
          const b=element('button','增加额度');b.type='button';b.className='secondary';b.onclick=()=>openCredit(a);action.append(b);
        }
      }
      const empty = select('empty-accounts'); empty.hidden = !!matches.length;
      empty.textContent = query ? '没有匹配的账号。' : role==='employee'?'暂无员工，点击「创建员工」即可添加。':'暂无账号。';
    }
    async function refresh() {
      accounts=(await requestJson('/api/operations/accounts')).accounts;
      render();
    }
    function selectTab(next) {
      role=next;
      for (const button of document.querySelectorAll('[data-role]')) button.setAttribute('aria-pressed',String(button.dataset.role===next));
      render();
    }
    for (const button of document.querySelectorAll('[data-role]')) button.onclick=()=>selectTab(button.dataset.role);
    select('account-search').oninput=render;
    select('new-employee').onclick=()=>show(select('employee-dialog'));
    document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>select(b.dataset.close).close());
    function onSubmit(formEl,action) {
      formEl.addEventListener('submit',async(event)=>{
        event.preventDefault();const b=formEl.querySelector('button'), dialog=formEl.closest('dialog');
        const feedback=formEl.querySelector('.modal-feedback');
        b.disabled=true;dialog.querySelector('[data-close]').disabled=true;
        try {await action(Object.fromEntries(new FormData(formEl)));dialog.close(); formEl.reset(); await refresh();}
        catch(e){if(dialog.open){feedback.hidden=false;feedback.textContent=e.message;feedback.classList.add('problem')}else status.textContent=e.message;}
        finally {b.disabled=false;dialog.querySelector('[data-close]').disabled=false;}
      });
      formEl.closest('dialog').addEventListener('cancel',e=>{if(formEl.querySelector('button').disabled)e.preventDefault()});
    }
    const post=(url,data)=>requestJson(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    onSubmit(form,async fields=>{
      await post('/api/operations/accounts',fields);
      select('account-search').value='';selectTab('employee');status.textContent='已创建员工账号 '+fields.email+'。';
    });
    credit.elements.amount.oninput=()=>{
      const delta=Math.round(Number(credit.elements.amount.value)*10000);
      select('credit-result').textContent=credit.elements.amount.validity.valid && delta>0
        ? '增加前 '+amount(target.availableRaw)+' · 预计增加后 '+amount(target.availableRaw+delta)
        :'当前可用余额 '+amount(target.availableRaw);
    };
    onSubmit(credit,async fields=>{
      const key='lumen:admin-credit:'+JSON.stringify([target.email,fields.amount,fields.note]);
      const requestId=sessionStorage.getItem(key)||crypto.randomUUID();sessionStorage.setItem(key,requestId);
      const data=await post('/api/commerce/admin/credit',{...fields,email:target.email,requestId});
      sessionStorage.removeItem(key);status.textContent=data.email+' 的可用余额已更新为 '+amount(data.availableRaw)+'。';
    });
    refresh().then(()=>{
      const email=new URL(location.href).searchParams.get('credit');
      const account=email && accounts.find(a=>a.enabled && a.email.toLowerCase()===email.toLowerCase());
      if(account) openCredit(account);
    }).catch(e=>{select('empty-accounts').textContent=e.message});
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
    const title = element('h2','发送邮箱');
    title.id = 'lumen-email-title';
    title.style.cssText = 'margin:0;font-size:20px;font-weight:650';
    const description = element('p',`将所选 ${ids.length} 张 eSIM 的二维码作为 Excel 附件发送。`);
    const sender = element('p','发件人  ·  站点已授权的 Outlook 邮箱');
    for (const paragraph of [description,sender]) paragraph.style.cssText = 'margin-top:8px;color:#5a7093;font-size:13px;line-height:1.5';
    const label = element('label','收件邮箱');
    label.style.cssText = 'display:block;margin-top:18px;font-size:13px;font-weight:600';
    const recipient = document.createElement('input');
    recipient.type = 'email'; recipient.required = true; recipient.maxLength = 254; recipient.autocomplete = 'email';
    recipient.placeholder = 'name@example.com';
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
      switch (heading.textContent.trim()) {
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
