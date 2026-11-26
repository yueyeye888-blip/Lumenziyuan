import { randomUUID } from 'node:crypto';
import { canManageAccounts } from '../resource-operations/account-access.mjs';
import { fault } from './wallet.mjs';
import { createSupportNotifier } from './support-telegram.mjs';
import { withLocale } from './locale-html.mjs';

const urlPath = '/__host/support';
const reviewPath = '/__host/refund-review';
const apiPath = '/api/support';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const states = {pending:'待复核', approved:'已批准退款', declined:'未批准退款', delivered:'已交付', open:'待回复', answered:'已回复'};
const when = ms => new Date(ms).toLocaleString('zh-CN',{timeZone:'Asia/Singapore',hour12:false});
const tg = '<a href="https://t.me/YorkeYue" target="_blank" rel="noopener noreferrer">@YorkeYue</a>';

export function createSupport({db,config,readBody,address,notify=createSupportNotifier(config)}) {
  db.exec(`CREATE TABLE IF NOT EXISTS support_tickets (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, email TEXT NOT NULL, order_ref TEXT NOT NULL,
    message TEXT NOT NULL, created_at INTEGER NOT NULL, reply TEXT, replied_at INTEGER, replied_by TEXT);
    CREATE INDEX IF NOT EXISTS support_tickets_user ON support_tickets(user_id,created_at);`);
  const columns = new Set(db.prepare('PRAGMA table_info(support_tickets)').all().map(column => column.name));
  if (!columns.has('kind')) db.exec("ALTER TABLE support_tickets ADD COLUMN kind TEXT NOT NULL DEFAULT 'ticket'");
  if (!columns.has('owner_seen_at')) db.exec('ALTER TABLE support_tickets ADD COLUMN owner_seen_at INTEGER');
  db.exec(`CREATE TABLE IF NOT EXISTS support_notifications (
    ticket_id TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0,
    next_at INTEGER NOT NULL, sent_at INTEGER);`);
  let sending = false;
  async function flushNotifications() {
    if (sending) return;
    sending = true;
    try {
      const pending = db.prepare(`SELECT t.id,t.kind,n.attempts FROM support_notifications n
        JOIN support_tickets t ON t.id=n.ticket_id WHERE n.sent_at IS NULL AND n.next_at<=?
        ORDER BY n.next_at LIMIT 5`).all(Date.now());
      for (const ticket of pending) {
        try {
          await notify(ticket);
          db.prepare('UPDATE support_notifications SET sent_at=? WHERE ticket_id=?').run(Date.now(),ticket.id);
        } catch {
          const delay = 30_000 * 2 ** Math.min(ticket.attempts,7);
          db.prepare('UPDATE support_notifications SET attempts=attempts+1,next_at=? WHERE ticket_id=?').run(Date.now()+delay,ticket.id);
        }
      }
    } finally { sending = false; }
  }

  function supportData(user, owner, url) {
    const filter = owner ? '1=1' : 'user_id=?';
    const args = owner ? [] : [user.id];
    const unread = owner ? db.prepare('SELECT COUNT(*) AS n FROM support_tickets WHERE owner_seen_at IS NULL AND reply IS NULL').get().n : 0;
    const result = { owner, unread };
    if (url.searchParams.has('summary')) return result;
    const columns = 'id,kind,order_ref AS orderRef,message,created_at AS createdAt,reply,replied_at AS repliedAt';
    const selected = url.searchParams.get('ticket') || '';
    result.tickets = db.prepare('SELECT '+columns+(owner?',email,(owner_seen_at IS NULL AND reply IS NULL) AS unread':'')+
      ' FROM support_tickets WHERE '+filter+' ORDER BY (id=?) DESC,'+(owner?'unread DESC,':'')+'created_at DESC,id DESC LIMIT 25').all(...args,selected);
    return result;
  }

  function field(f,key,max,required=true) {
    const v=(f.get(key)||'').trim();
    if ((required&&!v)||v.length>max) throw fault(400,'请检查填写内容与字数限制。');
    return v;
  }
  async function post(req,user,owner,reviewOnly) {
    if (![config.origin,...(config.aliasOrigins||[])].includes(req.headers.origin) ||
        !/^application\/x-www-form-urlencoded(?:;|$)/i.test(req.headers['content-type']||''))
      throw fault(403,'请从本站客服页面提交。');
    const f=new URLSearchParams((await readBody(req,24576)).toString());
    const action=f.get('action');
    if (reviewOnly && action !== 'decide') throw fault(400,'无效的审核操作。');
    if (action==='create') {
      const msg=field(f,'message',2000),ref=field(f,'order',100,false),id=f.get('id');
      if (!/^[a-f0-9-]{36}$/.test(id||'')) throw fault(400,'请刷新工单表单。');
      const kind = f.get('kind') || 'ticket';
      if (!['message','ticket'].includes(kind)) throw fault(400,'无效的客服类型。');
      const old=db.prepare('SELECT user_id,message,order_ref,kind FROM support_tickets WHERE id=?').get(id);
      if (old) {
        if (old.user_id!==user.id||old.message!==msg||old.order_ref!==ref||old.kind!==kind) throw fault(409,'提交编号已使用，请刷新重试。');
        return;
      }
      if(db.prepare('SELECT COUNT(*) AS n FROM support_tickets WHERE user_id=? AND created_at>?').get(user.id,Date.now()-60000).n>=5) throw fault(429,'工单已收到，请稍后再提交。');
      const createdAt = Date.now();
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('INSERT INTO support_tickets(id,user_id,email,order_ref,message,created_at,kind) VALUES(?,?,?,?,?,?,?)')
          .run(id,user.id,user.email,ref,msg,createdAt,kind);
        db.prepare('INSERT INTO support_notifications(ticket_id,next_at) VALUES(?,?)').run(id,createdAt);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      void flushNotifications().catch(() => console.warn('Support notifications deferred'));
      return;
    }
    if (!owner) throw fault(403,'仅平台所有者可以处理工单和复核退款。');
    if(action==='read'){
      db.prepare('UPDATE support_tickets SET owner_seen_at=? WHERE id=? AND owner_seen_at IS NULL').run(Date.now(),field(f,'id',60));
      return;
    }
    if(action==='reply'){
      const result=db.prepare('UPDATE support_tickets SET reply=?,replied_by=?,replied_at=?,owner_seen_at=COALESCE(owner_seen_at,?) WHERE id=? AND reply IS NULL')
        .run(field(f,'reply',2000),user.id,Date.now(),Date.now(),field(f,'id',60));
      if(!result.changes)throw fault(409,'工单已回复或不存在。');
      return;
    }
    if(action==='decide')return address.decideRefund(user,field(f,'id',100),field(f,'decision',12),field(f,'note',500));
    throw fault(400,'无效操作。');
  }
  const hidden=(key,value)=>'<input type="hidden" name="'+key+'" value="'+esc(value)+'">';
  const form=(action,id,body)=>'<form method="post" action="'+(action==='decide'?reviewPath:urlPath)+'">'+hidden('action',action)+hidden('id',id)+body+'</form>';
  function reviewList(owner,args,page,view) {
    const where = !owner ? 'WHERE b.user_id=?' : view === 'history' ? "WHERE r.decision<>'pending'" : view === 'pending' ? "WHERE r.decision='pending'" : '';
    const rows = db.prepare(`SELECT r.*, b.request_no, COALESCE(p.amount_raw,h.amount) AS amount
      FROM address_refund_reviews r JOIN address_bills b ON b.id=r.bill_id
      LEFT JOIN address_prepayments p ON p.bill_id=b.id LEFT JOIN wallet_holds h ON h.reference=b.id
      ${where} ORDER BY (r.decision='pending') DESC,r.opened_at DESC,r.bill_id DESC LIMIT 21 OFFSET ?`).all(...args,page*20);
    return {rows:rows.slice(0,20),more:rows.length>20};
  }
  function decisionForm(row) {
    return form('decide',row.bill_id,`<label>审核说明<textarea name="note" maxlength="500" required rows="2" placeholder="填写核查结果"></textarea></label>
      <div class="refund-actions"><button name="decision" value="declined" class="button-light">不予退款</button>
      <button name="decision" value="approved">批准退款</button></div>`);
  }
  function refundPage(url,page) {
    const view = url.searchParams.get('view') === 'history' ? 'history' : 'pending';
    const {rows,more} = reviewList(true,[],page,view);
    const summary = db.prepare(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE decision='pending') AS pending,
      SUM(CASE WHEN decision='pending' THEN COALESCE(p.amount_raw,h.amount,0) ELSE 0 END) AS openAmount
      FROM address_refund_reviews r LEFT JOIN address_prepayments p ON p.bill_id=r.bill_id
      LEFT JOIN wallet_holds h ON h.reference=r.bill_id`).get();
    const selected = rows.find(row => row.bill_id === url.searchParams.get('case')) || rows[0];
    const amount = raw => raw == null ? '—' : (raw/10000).toLocaleString('en',{minimumFractionDigits:2,maximumFractionDigits:4});
    const status = row => `<span class="review-status" data-state="${esc(row.decision)}">${esc(states[row.decision])}</span>`;
    const tabs = [['pending','待审核',summary.pending],['history','已处理',summary.total-summary.pending]]
      .map(([key,label,count])=>`<a href="?view=${key}" ${key===view?'aria-current="page"':''}><span>${label}</span><b>${count}</b></a>`).join('');
    const entries = rows.map(row=>`<li><a href="?view=${view}&amp;page=${page}&amp;case=${encodeURIComponent(row.bill_id)}#case-detail"
      ${row===selected?'aria-current="true"':''}><strong>${esc(row.request_no)}</strong><b>${amount(row.amount)} U</b>
      <time>${esc(when(row.opened_at))}</time>${status(row)}</a></li>`).join('');
    const detail = selected ? `<div class="case-title">${status(selected)}<h2>${esc(selected.request_no)}</h2></div>
      <dl><div><dt>实扣金额</dt><dd>${amount(selected.amount)} <small>U</small></dd></div>
      <div><dt>登记时间</dt><dd>${esc(when(selected.opened_at))}</dd></div></dl>
      <h3>登记原因</h3><p class="case-note">${esc(selected.reason)}</p>
      ${selected.decision==='pending'?decisionForm(selected):`<h3>处理时间</h3><p>${esc(when(selected.decided_at))}</p>
        ${selected.decision_note?`<h3>审核说明</h3><p data-lumen-no-translate>${esc(selected.decision_note)}</p>`:''}`}` : '';
    return withLocale(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>退款审核 · Yorke AI</title></head>
      <body class="support-page review-console"><main><nav class="review-crumb"><a href="/">Yorke AI</a><span aria-hidden="true">/</span><span>退款审核</span></nav>
      <header class="review-banner"><div><h1>退款审核</h1><p>核查异常地址订单。审批通过后，实扣金额退回原平台余额。</p></div>
      <dl><div><dt>待审核金额</dt><dd>${amount(summary.openAmount||0)} <small>U</small></dd></div>
      <div><dt>已处理</dt><dd>${summary.total-summary.pending}</dd></div></dl></header>
      <div class="review-desk"><section class="review-queue"><nav class="review-tabs">${tabs}</nav>
      ${entries?`<ul>${entries}</ul>`:`<p class="queue-empty">${view==='pending'?'暂无待审核订单。':'暂无已处理订单。'}</p>`}
      <nav class="review-pages">${pagination(page,more,'view='+view+'&')}</nav></section>
      ${detail?`<section id="case-detail" class="case-detail">${detail}</section>`:''}</div></main></body></html>`);
  }
  function pagination(page,more,query='') {
    return (page?'<a href="?'+query+'page='+(page-1)+'">上一页</a> ':'')+(more?'<a href="?'+query+'page='+(page+1)+'">下一页</a>':'');
  }
  function render(user,owner,url) {
    const page=Math.max(0,Math.min(100000,parseInt(url.searchParams.get('page'),10)||0));
    const args=owner?[]:[user.id];
    if (url.pathname === reviewPath) return refundPage(url,page);
    const reviews = owner ? {rows:[],more:false} : reviewList(false,args,page);
    const cases = reviews.rows.map(row => `<article><strong>${esc(row.request_no)} · ${esc(states[row.decision])}</strong>
      <small>${esc(when(row.opened_at))} · ${esc(row.amount/10000)} U</small><p>${esc(row.reason)}</p>
      ${row.decision_note?'<p>'+esc(row.decision_note)+'</p>':''}</article>`).join('');
    const tickets=db.prepare('SELECT * FROM support_tickets '+(owner?'':'WHERE user_id=?')+' ORDER BY (reply IS NULL) DESC,created_at DESC LIMIT 21 OFFSET ?').all(...args,page*20);
    const makeTicket=form('create',randomUUID(),'<label>订单号（选填）<input name="order" maxlength="100" value="'+esc((url.searchParams.get('order')||'').slice(0,100))+'"></label><label>问题描述<textarea name="message" required maxlength="2000" rows="3"></textarea></label><button>提交工单</button>');
    const records=tickets.slice(0,20).map(t=>'<article><strong>工单 '+esc(t.id.slice(0,8))+' · '+(t.reply?'已回复':'待回复')+'</strong><small>'+esc(when(t.created_at))+(owner?' · '+esc(t.email):'')+'</small>'+(t.order_ref?'<p>关联订单 '+esc(t.order_ref)+'</p>':'')+'<p data-lumen-no-translate>'+esc(t.message)+'</p>'+(t.reply?'<p><b>客服回复</b> <span data-lumen-no-translate>'+esc(t.reply)+'</span></p>':owner?form('reply',t.id,'<label>回复<textarea name="reply" required maxlength="2000"></textarea></label><button>发送回复</button>'):'')+'</article>').join('');
    const nav=pagination(page,reviews.more||tickets.length>20);
    return withLocale('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>客服中心 · Yorke AI</title></head><body class="support-page"><main><a href="/">返回平台</a><h1>客服中心</h1><p>Telegram '+tg+'</p>'+(owner?'<p><a href="'+reviewPath+'">退款审核</a></p>':'')+'<section><h2>提交工单</h2>'+makeTicket+'</section>'+(cases?'<section><h2>我的订单复核</h2>'+cases+'</section>':'')+'<section><h2>'+(owner?'客户工单':'我的工单')+'</h2>'+(records||'<p>暂无工单。</p>')+'</section>'+nav+'</main></body></html>');
  }
  async function route(req,res,url,user) {
    const reviewOnly = url.pathname === reviewPath;
    const api = url.pathname === apiPath;
    if(!reviewOnly && !api && url.pathname!==urlPath)return false;
    const owner=canManageAccounts(config,user);
    function json(status, data) {
      res.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'private, no-store'});
      res.end(JSON.stringify(data));
    }
    try{
      if (api) {
        if (req.method === 'POST') await post(req,user,owner,false);
        else if (req.method !== 'GET') { json(405,{error:'请求方式不支持。'}); return true; }
        json(200,supportData(user,owner,url));
        return true;
      }
      if (reviewOnly && !owner) throw fault(403,'仅平台所有者可以审核退款。');
      if(req.method==='GET'){
        const html=render(user,owner,url);
        res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'private, no-store','content-security-policy':"default-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'"});
        res.end(html);
      }else if(req.method==='POST'){
        await post(req,user,owner,reviewOnly);
        res.writeHead(303,{location:reviewOnly?reviewPath:urlPath,'cache-control':'no-store'});res.end();
      }else{res.writeHead(405,{allow:'GET, POST'});res.end();}
    }catch(e){
      if(res.headersSent) throw e;
      const status=e.status||503;
      if (api) { json(status,{error:e.status?e.message:'服务暂时不可用，请稍后查询。'}); return true; }
      res.writeHead(status,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
      res.end('<meta charset="utf-8"><p>'+esc(e.status?e.message:'服务暂时不可用，请稍后查询。')+'</p><a href="'+urlPath+'">返回客服中心</a>');
    }
    return true;
  }
  return { route, flushNotifications };
}
