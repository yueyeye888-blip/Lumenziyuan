(() => {
  const money = raw => new Intl.NumberFormat('en-US', {
    style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:4,
  }).format(raw / 10_000).replace('$','') + ' U';
  const time = new Intl.DateTimeFormat('zh-CN',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Singapore'});
  const statuses = { allocating:'供应商已接单，正在分配 eSIM',ready:'已交付',rejected:'供应商未接单',uncertain:'等待确认供应商是否接单' };
  let activeDialog;

  function node(tag,text,className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  function button(text,action,primary = false) {
    const element = node('button',text,primary ? 'lumen-buy-primary' : '');
    element.type = 'button';
    if (action) element.addEventListener('click',action);
    return element;
  }
  async function request(path,fields,timeout=42_000) {
    const response = await fetch('/api/esim/' + path,{
      cache:'no-store',mode:'same-origin',signal:AbortSignal.timeout(timeout),
      ...(fields ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(fields)} : {}),
    });
    const data = await response.json();
    if (!response.ok && !data.order) {
      const error = Error(data.error || '操作暂时不可用，请重试。');
      error.status = response.status;
      throw error;
    }
    return data;
  }
  function dialog(title) {
    if (activeDialog) return;
    const modal = node('dialog',undefined,'lumen-buy');
    const heading = node('h2',title);
    heading.id = 'lumen-buy-heading';
    modal.setAttribute('aria-labelledby',heading.id);
    const close = button('关闭',() => modal.close());
    const header = node('header');
    header.append(heading,close);
    const content = node('div',undefined,'lumen-buy-content');
    const feedback = node('p','', 'lumen-buy-feedback');
    feedback.setAttribute('role','status');
    content.append(feedback);
    modal.append(header,content);
    document.body.append(modal);
    activeDialog = modal;
    modal.addEventListener('close',() => {
      modal.remove();
      if (activeDialog === modal) activeDialog = undefined;
    },{once:true});
    modal.showModal();
    return { modal, heading, content, feedback, close, busy(state) {
      close.disabled = state;
      modal.oncancel = state ? event => event.preventDefault() : null;
    } };
  }
  const refresh = () => window.dispatchEvent(new Event('lumen:refresh-esim'));

  function showStatus(frame, order, beforeClose) {
    const { modal,heading,content,feedback } = frame;
    heading.textContent = '购买结果';
    const success = order.status === 'allocating' || order.status === 'ready';
    const details = node('div',undefined,'lumen-buy-summary');
    details.append(node('strong',statuses[order.status]),node('p','Yorke AI 单号 ' + order.id));
    if (order.orderNo) details.append(node('p','eSIMAccess 订单号 ' + order.orderNo));
    if (success) details.append(node('p','订单金额 ' + money(order.amountRaw)));
    if (order.status === 'ready') details.append(node('p','二维码可在「我的购买」查看。'));
    if (order.status === 'uncertain') details.append(node('p','供应商尚未确认结果。请保留单号，通过购买订单查询，避免重复下单。'));
    if (order.error) details.append(node('p',order.error,'lumen-buy-feedback'));
    const actions = node('div',undefined,'lumen-buy-actions');
    if (order.status === 'allocating' || order.status === 'uncertain') {
      const poll = button('查询订单状态',async () => {
        poll.disabled = true;
        feedback.textContent = '正在查询订单…';
        try {
          const {order:current} = await request('purchases?id=' + encodeURIComponent(order.id));
          if (modal.open) showStatus(frame,current,beforeClose);
        } catch(error) { feedback.textContent = error.message; }
        finally { poll.disabled = false; }
      });
      actions.append(poll);
    }
    actions.append(button('查看购买订单',() => {
      modal.close();
      // The close event fires asynchronously.
      queueMicrotask(() => { if (activeDialog === modal) activeDialog = undefined; void orderHistory(); });
    },true));
    feedback.textContent = '';
    content.replaceChildren(details,feedback,actions);
    if (order.status === 'uncertain' && order.canRetry) {
      const retry = button('重试同一订单',() => {
        const form = node('form');
        const confirm = button('确认重试同一单号',undefined,true);
        confirm.type = 'submit';
        const controls = node('div',undefined,'lumen-buy-actions');
        controls.append(confirm);
        form.append(node('p','将按原套餐、数量和金额再次提交同一个订单号。','lumen-buy-note'),controls);
        feedback.before(form);
        retry.remove();
        confirm.focus();
        form.addEventListener('submit',async event => {
          event.preventDefault();
          if (confirm.disabled || !form.reportValidity()) return;
          frame.busy(true);
          confirm.disabled = true;
          try {
            const {order:current} = await request('purchases',{id:order.id,retry:true});
            showStatus(frame,current,beforeClose);
          } catch(error) { feedback.textContent=error.message; }
          finally { confirm.disabled=false; frame.busy(false); }
        });
      });
      actions.prepend(retry);
    }
    if (order.status === 'allocating' && !frame.polling) {
      frame.polling = true;
      void (async () => {
        for (let attempt=0; attempt<5 && modal.open; attempt++) {
          await new Promise(resolve => setTimeout(resolve,6_000));
          if (!modal.open) break;
          try {
            const {order:current} = await request('purchases?id=' + encodeURIComponent(order.id));
            if (current.status === 'ready' && modal.open) {
              showStatus(frame,current,beforeClose);
              break;
            }
          } catch { /* Manual status lookup remains available. */ }
        }
        frame.polling = false;
      })();
    }
    if (success && !frame.accepted) {
      frame.accepted = true;
      beforeClose?.();
    }
    if (order.status === 'ready') refresh();
  }

  function paymentSource(quote) {
    return quote.paymentSource === 'supplier' ? 'eSIMAccess 供应商余额' : '站内钱包';
  }

  async function checkout(selection) {
    const frame = dialog(selection.ids.length === 1 ? '购买套餐' : '合并购买');
    if (!frame) return;
    const { modal,content,feedback } = frame;
    feedback.textContent = '正在获取套餐售价…';
    let quote;
    try { quote = await request('purchase-quote',{ids:selection.ids}); }
    catch(error) { feedback.textContent=error.message; return; }
    if (!modal.open) return;
    if (quote.pending) { showStatus(frame,quote.pending); return; }
    const requestId = 'LH-' + crypto.randomUUID();
    const form = node('form');
    const list = node('div',undefined,'lumen-buy-lines');
    const countFields = quote.lines.map(line => {
      const item = node('div',undefined,'lumen-buy-line');
      const info = node('div');
      info.append(node('strong',line.name),node('p',money(line.priceRaw) + (line.periodNum ? ' / 张 · 1 天' : ' / 张')));
      const label = node('label','数量');
      const count = node('input');
      Object.assign(count,{type:'number',inputMode:'numeric',min:'1',max:String(quote.maxCards),step:'1',value:'1',required:true});
      count.setAttribute('aria-label',line.name+' 的购买数量');
      label.append(count);
      item.append(info,label);
      list.append(item);
      return count;
    });
    const summary = node('div',undefined,'lumen-buy-summary');
    const amount = node('strong','');
    const unitCount = node('p','');
    summary.append(amount,unitCount,node('p',paymentSource(quote) + '可用 ' + money(quote.availableRaw)));
    const actions = node('div',undefined,'lumen-buy-actions');
    const submit = button('确认并下单',undefined,true);
    submit.type = 'submit';
    const cancel = button('取消',() => modal.close());
    actions.append(cancel,submit);
    form.append(list,summary);
    const warning = node('p',quote.paymentSource === 'supplier' ? '确认后按供应商原价从 eSIMAccess 账户余额结算。' : '确认后从站内钱包扣款，由 eSIMAccess 创建订单。','lumen-buy-note');
    form.append(warning);
    form.append(feedback,actions);
    feedback.textContent = '';
    content.replaceChildren(form);
    let busy = false;
    let blocked = false;
    const checkTotal = () => {
      const counts = countFields.map(field => field.valueAsNumber);
      const count = counts.reduce((sum,n) => sum + n,0);
      const valid = counts.every(n => Number.isInteger(n) && n > 0) && count <= quote.maxCards;
      const total = quote.lines.reduce((sum,line,index) => sum + line.priceRaw * counts[index],0);
      amount.textContent = valid ? '合计 ' + money(total) : '请核对购买数量';
      unitCount.textContent = valid ? count + ' 张 eSIM' : '每单合计最多 ' + quote.maxCards + ' 张';
      feedback.textContent = valid && total > quote.availableRaw ? paymentSource(quote) + '余额不足。' : '';
      submit.disabled = !valid || total > quote.availableRaw || busy || blocked;
      return valid && total <= quote.availableRaw;
    };
    list.addEventListener('input',checkTotal);
    checkTotal();
    form.addEventListener('submit',async event => {
      event.preventDefault();
      if (busy || blocked || !checkTotal() || !form.reportValidity()) return;
      const data = { id:requestId,items:quote.lines.map(({id,priceRaw},index) => ({id,priceRaw,count:countFields[index].valueAsNumber})) };
      busy = true;
      frame.busy(true);
      cancel.disabled = submit.disabled = true;
      countFields.forEach(field => { field.disabled = true; });
      feedback.textContent = '正在提交到 eSIMAccess…';
      try {
        const {order} = await request('purchases',data);
        showStatus(frame,order,selection.accepted);
      } catch(error) {
        if (error.status && error.status < 500) {
          feedback.textContent = error.message;
          if (error.status === 409 || error.status === 402) {
            blocked = true;
            actions.append(button('重新获取报价',() => {
              modal.close();
              if (activeDialog === modal) activeDialog = undefined;
              void checkout(selection);
            }));
          }
        } else {
          blocked = true;
          feedback.textContent = '提交结果待确认。请先查询当前单号 ' + requestId;
          const followUp = button('查询当前订单',async () => {
            followUp.disabled = true;
            try {
              const {order} = await request('purchases?id=' + encodeURIComponent(requestId));
              showStatus(frame,order,selection.accepted);
            } catch (lookupError) {
              feedback.textContent = lookupError.status === 404 ? '暂未查到该单，请稍后再次查询。' : lookupError.message;
            } finally { followUp.disabled = false; }
          });
          actions.append(followUp);
        }
      } finally {
        busy = false;
        frame.busy(false);
        cancel.disabled = false;
        countFields.forEach(field => { field.disabled = false; });
        submit.disabled = blocked;
      }
    });
  }

  async function orderHistory() {
    const frame = dialog('购买订单');
    if (!frame) return;
    const {modal,content,feedback} = frame;
    const records = node('div',undefined,'lumen-buy-lines');
    let offset=0;
    const more = button('加载更多',() => void list());
    const reload = button('刷新订单状态',() => {
      offset=0;
      records.replaceChildren();
      void list();
    });
    const footer = node('div',undefined,'lumen-buy-actions');
    footer.append(more,reload);
    content.append(records,footer);
    async function list() {
      reload.disabled = more.disabled = true;
      feedback.textContent = '正在查询订单…';
      try {
        const { orders,hasMore } = await request('purchases?offset=' + offset);
        if (!modal.open) return;
        feedback.textContent = orders.length || offset ? '' : '还没有通过本站创建的 eSIMAccess 订单。';
        for (const order of orders) {
          const article = node('article',undefined,'lumen-buy-summary');
          article.append(node('strong',statuses[order.status]),
            node('p',time.format(new Date(order.createdAt))+' · '+order.account),
            node('p',order.items.map(item=>item.name+' × '+item.count).join('，')),
            node('p','Yorke AI 单号 '+order.id));
          if (order.orderNo) article.append(node('p','eSIMAccess 订单号 '+order.orderNo+' · '+money(order.amountRaw)));
          if (order.error) article.append(node('p',order.error,'lumen-buy-feedback'));
          if (order.status === 'uncertain') {
            const inspect=button('查看订单详情',async () => {
              inspect.disabled=true;
              frame.busy(true);
              try {
                const {order:current}=await request('purchases?id='+encodeURIComponent(order.id));
                if (modal.open) showStatus(frame,current);
              } catch(error) { feedback.textContent=error.message; }
              finally { inspect.disabled=false; frame.busy(false); }
            });
            article.append(inspect);
          }
          records.append(article);
        }
        if (orders.some(order => order.status === 'ready') && offset === 0) refresh();
        offset += orders.length;
        more.hidden = !hasMore;
      } catch(error) { feedback.textContent=error.message; }
      finally { reload.disabled = more.disabled = false; }
    }
    await list();
  }

  const renewalStatuses = {
    queued:'等待提交', submitting:'正在提交供应商', succeeded:'已续费', uncertain:'待核对供应商结果',
    rejected:'续费失败', not_sent:'尚未发送',
  };
  const renewalRunning = row => ['queued','submitting'].includes(row.status);
  function renewalRow(row) {
    const entry = node('article',undefined,'lumen-buy-summary');
    entry.append(node('strong',renewalStatuses[row.status]),node('p',row.card+' · '+row.maskedIccid),
      node('p',row.plan+' · '+money(row.amountRaw)));
    if (row.account) entry.append(node('p',time.format(new Date(row.createdAt))+' · '+row.account));
    if (row.receipt) entry.append(node('p','供应商回执 '+row.receipt));
    if (row.expiredTime) entry.append(node('p','供应商返回有效期 '+time.format(new Date(row.expiredTime))));
    if (row.status === 'uncertain') entry.append(node('p','核对单号 '+row.id));
    if (row.error) entry.append(node('p',row.error,'lumen-buy-feedback'));
    return entry;
  }

  function renewalResult(frame, id, initial) {
    const {modal,heading,content,feedback} = frame;
    heading.textContent = '续费结果';
    const results = node('div',undefined,'lumen-buy-lines');
    const actions = node('div',undefined,'lumen-buy-actions');
    const update = button('刷新续费状态',() => void load());
    actions.append(update);
    const total = node('p','', 'lumen-buy-note');
    content.replaceChildren(total,results,feedback,actions);
    let timer;
    let busy = false;
    let refreshedCount = 0;
    let checks = 0;
    function render(rows) {
      const count = rows.filter(row => row.status === 'succeeded').length;
      const pending = rows.filter(renewalRunning).length;
      const unknown = rows.filter(row => row.status === 'uncertain').length;
      total.textContent = '已续费 '+count+' / '+rows.length+' 张' +
        (pending ? ' · 处理中 '+pending+' 张' : '') + (unknown ? ' · 待核对 '+unknown+' 张' : '');
      feedback.textContent = unknown ? '请按续费记录中的核对单号与供应商核实。该卡暂时不会接受下一笔续费。' : '';
      results.replaceChildren(...rows.map(renewalRow));
      if (count > refreshedCount) { refreshedCount=count; refresh(); }
      if (pending && checks < 30) timer=window.setTimeout(() => void load(),2500);
    }
    async function load() {
      if (!modal.open || busy) return;
      window.clearTimeout(timer);
      busy=true;
      update.disabled=true;
      try {
        const { records } = await request('renewals?id='+encodeURIComponent(id));
        if (modal.open) render(records);
      } catch (error) {
        if (modal.open) {
          feedback.textContent=error.status === 404 ? '暂未查询到该请求，请稍后刷新。' : error.message;
          if (checks < 30) timer=window.setTimeout(() => void load(),2500);
        }
      } finally { checks++; busy=false; update.disabled=false; }
    }
    modal.addEventListener('close',() => window.clearTimeout(timer),{once:true});
    if (initial) render(initial);
    else {
      feedback.textContent='正在核对本次续费状态…';
      void load();
    }
  }

  async function startRenewal(selection) {
    const single=!selection.batch && selection.ids.length===1;
    const frame=dialog(single ? 'eSIM 续费' : '批量续费');
    if (!frame) { selection.close(); return; }
    const {modal,content,feedback}=frame;
    modal.addEventListener('close',selection.close,{once:true});
    feedback.textContent='正在查询 eSIMAccess 的兼容套餐和价格…';
    let quote;
    try { quote=await request('renewal-quote',{ids:selection.ids,batch:!single},120_000); }
    catch (error) { feedback.textContent=error.message; return; }
    if (!modal.open) return;
    const form=node('form');
    const list=node('div',undefined,'lumen-buy-lines');
    const rows=quote.cards.filter(card=>card.options.length);
    const choose=node('select');
    choose.setAttribute('aria-label','兼容续费套餐');
    for (const card of quote.cards) {
      const entry=node('div',undefined,'lumen-buy-summary');
      entry.append(node('strong',(card.name || 'eSIM')+' '+(card.maskedIccid || '')));
      if (card.reason) entry.append(node('p',card.reason,'lumen-buy-feedback'));
      else if (single) {
        for (const plan of card.options) {
          const duration=plan.duration ? ' · '+plan.duration+(plan.durationUnit==='DAY'?' 天':' '+(plan.durationUnit || '')) : '';
          const option=node('option',plan.name+duration+' · '+money(plan.priceRaw));
          option.value=plan.code;
          choose.append(option);
        }
        const picker=node('label','兼容续费套餐','lumen-buy-pin');
        picker.append(choose);
        entry.append(picker);
      } else {
        const option=card.options[0];
        entry.append(node('p',option.name+' · '+money(option.priceRaw)));
      }
      list.append(entry);
    }
    form.append(list);
    const summary=node('div',undefined,'lumen-buy-summary');
    const amount=node('strong','');
    summary.append(amount,node('p',paymentSource(quote) + '可用 ' + money(quote.availableRaw)));
    if (quote.cards.length > rows.length) summary.append(node('p',quote.cards.length-rows.length+' 张无法续费，实际提交 '+rows.length+' 张。'));
    form.append(summary);
    feedback.textContent='';
    if (!rows.length) {
      const total=rows.reduce((price,card)=>price+card.options[0].priceRaw,0);
      amount.textContent='应付 '+money(total);
      content.replaceChildren(form,feedback);
      return;
    }
    const actions=node('div',undefined,'lumen-buy-actions');
    const submit=button('确认续费',undefined,true);
    submit.type='submit';
    actions.append(submit);
    form.append(node('p',quote.paymentSource === 'supplier' ? '确认后按供应商原价从 eSIMAccess 账户余额结算。' : '确认后从站内钱包扣款，按每张卡的供应商回执显示结果。','lumen-buy-note'),feedback,actions);
    content.replaceChildren(form);
    let busy=false;
    function validate() {
      const total=single ? rows[0].options.find(option=>option.code===choose.value).priceRaw :
        rows.reduce((amount,card)=>amount+card.options[0].priceRaw,0);
      amount.textContent='应付 '+money(total);
      submit.disabled=busy || total>quote.availableRaw;
      feedback.textContent=total>quote.availableRaw ? paymentSource(quote) + '余额不足。' : '';
    }
    validate();
    choose.addEventListener('change',validate);
    form.addEventListener('submit',async event => {
      event.preventDefault();
      if (busy || submit.disabled || !form.reportValidity()) return;
      busy=true;
      frame.busy(true);
      submit.disabled=choose.disabled=true;
      feedback.textContent='正在提交续费…';
      try {
        const result=await request('renewals',{id:quote.id,code:single?choose.value:undefined});
        renewalResult(frame,quote.id,result.records);
      } catch(error) {
        if (!error.status || error.status>=500) renewalResult(frame,quote.id);
        else feedback.textContent=error.message;
      } finally {
        busy=false;
        frame.busy(false);
        submit.disabled=choose.disabled=false;
      }
    });
  }

  async function renewalHistory() {
    const frame=dialog('续费记录');
    if (!frame) return;
    const {content,feedback}=frame;
    const list=node('div',undefined,'lumen-buy-lines');
    const actions=node('div',undefined,'lumen-buy-actions');
    let offset=0;
    const refreshList=button('刷新记录',() => {offset=0;list.replaceChildren();void load();});
    const more=button('加载更多',() => void load());
    more.hidden=true;
    actions.append(more,refreshList);
    content.append(list,actions);
    async function load() {
      more.disabled=refreshList.disabled=true;
      feedback.textContent='正在查询续费记录…';
      try {
        const result=await request('renewals?offset='+offset);
        list.append(...result.records.map(renewalRow));
        feedback.textContent=result.records.length || offset ? '' : '暂无续费记录。';
        offset+=result.records.length;
        more.hidden=!result.hasMore;
      } catch(error) { feedback.textContent=error.message; }
      finally { more.disabled=refreshList.disabled=false; }
    }
    await load();
  }

  window.addEventListener('lumen:renew',event => void startRenewal(event.detail));
  window.addEventListener('lumen:renewal-history',() => void renewalHistory());

  window.addEventListener('lumen:checkout',event => void checkout(event.detail));
  window.addEventListener('lumen:esim-orders',() => void orderHistory());
  window.addEventListener('lumen:esim-quota',() => { window.location.assign('/__host/accounts'); });
})();
