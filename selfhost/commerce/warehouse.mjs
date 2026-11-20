import { createHash, webcrypto } from 'node:crypto';
import { trustedHeaders } from '../auth.mjs';
import { fault } from './wallet.mjs';
import { createWarehousePrices } from './warehouse-prices.mjs';

const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const emailValid = email => typeof email==='string' && email.length<=254 && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email);
const send=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store'});res.end(JSON.stringify(data));return true;};
async function body(req) {
  let bytes=0; const chunks=[];
  for await (const chunk of req) {bytes+=chunk.length;if(bytes>8192)throw fault(413,'认领资料过长。');chunks.push(chunk);}
  try {return JSON.parse(Buffer.concat(chunks));} catch {throw fault(400,'认领资料格式无效。');}
}

export function createWarehouse({wallet,db,mf,config,outlook,verifyPin,fetchImpl=fetch,now=Date.now}) {
  const price=createWarehousePrices({fetchImpl,now});
  const active=new Map();
  const origins=new Set([config.origin,...(config.aliasOrigins||[])]);
  db.exec(`CREATE TABLE IF NOT EXISTS stock_orders (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, actor_email TEXT NOT NULL, actor_name TEXT NOT NULL,
    batch TEXT NOT NULL, quantity INTEGER NOT NULL, recipient TEXT NOT NULL, unit_raw INTEGER NOT NULL,
    base_price INTEGER, currency TEXT NOT NULL, created TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'holding', email_status TEXT NOT NULL DEFAULT 'pending',
    email_error TEXT, provider TEXT, published INTEGER NOT NULL DEFAULT 0
  ); CREATE INDEX IF NOT EXISTS stock_orders_recovery ON stock_orders(published,state);`);
  const get=id=>db.prepare('SELECT * FROM stock_orders WHERE id=?').get(id);
  let ready;
  async function inventory() {
    if (!ready) ready=(async()=>{
      const d1=await mf.getD1Database('DB');
      await d1.batch([
        d1.prepare('CREATE TABLE IF NOT EXISTS warehouse_allocations (id TEXT PRIMARY KEY,accepted INTEGER NOT NULL)'),
        d1.prepare('CREATE TABLE IF NOT EXISTS warehouse_allocation_items (id TEXT PRIMARY KEY,order_id TEXT NOT NULL)'),
        d1.prepare('CREATE INDEX IF NOT EXISTS warehouse_allocation_order ON warehouse_allocation_items(order_id)'),
      ]);
      return d1;
    })().catch(error=>{ready=null;throw error;});
    return ready;
  }
  async function reserve(user,fields,id) {
    const existing=get(id);
    if (existing) {
      if (existing.user_id!==user.id || existing.batch!==fields.batchId || existing.quantity!==fields.quantity ||
          existing.recipient!==fields.recipientEmail || existing.unit_raw!==fields.quotedUnitRaw) throw fault(409,'认领请求与原订单不符。');
      return;
    }
    const d1=await inventory();
    const row=await d1.prepare("SELECT unit_price,currency FROM warehouse_inventory WHERE batch_id=? AND status='available' LIMIT 1").bind(fields.batchId).first();
    if (!row) throw fault(409,'该批次库存已被认领，请刷新库存。');
    const {retailUnitRaw}=await price(row.unit_price,row.currency);
    const total=retailUnitRaw*fields.quantity;
    if (retailUnitRaw!==fields.quotedUnitRaw || !Number.isSafeInteger(total)) throw fault(409,'售价已变更，请刷新库存并核对总额。');
    if (total>0) {
      if (!verifyPin) throw fault(503,'支付密码服务暂不可用。');
      await verifyPin(user,fields.pin);
    }
    wallet.atomic(()=>{
      if (get(id)) return;
      if (total) wallet.reserve(user.id,id,total);
      db.prepare(`INSERT INTO stock_orders(id,user_id,actor_email,actor_name,batch,quantity,recipient,unit_raw,base_price,currency,created)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id,user.id,user.email,user.name||user.email,fields.batchId,fields.quantity,fields.recipientEmail,retailUnitRaw,row.unit_price,row.currency,new Date(now()).toISOString());
    });
  }
  async function allocate(d1,o) {
    const filter="batch_id=? AND status='available' AND unit_price IS ? AND currency=?";
    const args=[o.batch,o.base_price,o.currency];
    // D1 runs the entire batch transactionally. Replays retain the same success or refusal.
    const result=await d1.batch([
      d1.prepare(`INSERT OR IGNORE INTO warehouse_allocations SELECT ?,COUNT(*)>=? FROM
        (SELECT id FROM warehouse_inventory WHERE ${filter} LIMIT ?)`).bind(o.id,o.quantity,...args,o.quantity),
      d1.prepare(`INSERT INTO warehouse_allocation_items SELECT id,? FROM warehouse_inventory WHERE ${filter}
        AND EXISTS(SELECT 1 FROM warehouse_allocations WHERE id=? AND accepted=1)
        AND NOT EXISTS(SELECT 1 FROM warehouse_allocation_items WHERE order_id=?)
        ORDER BY created_at, id LIMIT ?`).bind(o.id,...args,o.id,o.id,o.quantity),
      d1.prepare(`UPDATE warehouse_inventory SET status='claimed',claimed_by_user_id=?,claimed_by_email=?,claimed_by_name=?,
        recipient_email=?,claimed_at=?,email_status='unknown',email_error='邮件发送结果待核对'
        WHERE status='available' AND id IN (SELECT id FROM warehouse_allocation_items WHERE order_id=?)`)
        .bind(o.user_id,o.actor_email,o.actor_name,o.recipient,o.created,o.id),
      d1.prepare('SELECT accepted,(SELECT COUNT(*) FROM warehouse_allocation_items WHERE order_id=?) n FROM warehouse_allocations WHERE id=?').bind(o.id,o.id),
    ]);
    const decision=result[3]?.results?.[0];
    if (!decision || (decision.accepted && decision.n!==o.quantity) || (!decision.accepted && decision.n!==0)) throw Error('Incomplete inventory decision');
    wallet.atomic(()=>{
      if (get(o.id).state!=='holding') return;
      if (o.unit_raw) {
        if (decision.accepted) wallet.capture(o.user_id,o.id);
        else wallet.release(o.user_id,o.id);
      }
      db.prepare('UPDATE stock_orders SET state=? WHERE id=?').run(decision.accepted?'fulfilled':'rejected',o.id);
    });
  }
  async function deliver(d1,o) {
    if (o.email_status==='sending') {
      db.prepare("UPDATE stock_orders SET email_status='unknown',email_error='请核对收件箱与垃圾邮箱。' WHERE id=?").run(o.id);
      return;
    }
    if (o.email_status!=='pending') return;
    const bindings=config.bindings||{};
    if (!outlook && (!bindings.RESEND_API_KEY || !bindings.DELIVERY_EMAIL_FROM)) {
      db.prepare("UPDATE stock_orders SET email_error='邮件服务尚未配置。' WHERE id=?").run(o.id);
      return;
    }
    const {results}=await d1.prepare(`SELECT w.product_name,w.supplier,w.country,w.encrypted_value,w.iv
      FROM warehouse_allocation_items a JOIN warehouse_inventory w ON w.id=a.id WHERE a.order_id=? ORDER BY w.id`).bind(o.id).all();
    const decryptKey=await webcrypto.subtle.importKey('raw',Buffer.from(bindings.SETTINGS_ENCRYPTION_KEY,'base64'),{name:'AES-GCM'},false,['decrypt']);
    const lines=await Promise.all(results.map(async (r,i)=>{
      const value=await webcrypto.subtle.decrypt({ name:'AES-GCM',iv:Buffer.from(r.iv,'base64') },decryptKey,Buffer.from(r.encrypted_value,'base64'));
      return `${i+1}. ${r.product_name} · ${r.supplier}${r.country?' · '+r.country:''}\n${new TextDecoder().decode(value)}`;
    }));
    const mail={to:o.recipient,subject:`Lumen 资源交付 · ${o.quantity} 项资源`,text:lines.join('\n\n')};
    const key='lumen-warehouse/'+createHash('sha256').update(o.id).digest('hex');
    db.prepare("UPDATE stock_orders SET email_status='sending' WHERE id=?").run(o.id);
    let state='unknown',error='邮件发送结果尚未确认，请核对收件箱和垃圾邮箱。',provider=null;
    try {
      const response=outlook ? await outlook.fetch(new Request('https://mail.internal/send',{method:'POST',headers:{'content-type':'application/json','idempotency-key':key},body:JSON.stringify(mail)}))
        : await fetchImpl('https://api.resend.com/emails',{method:'POST',headers:{'content-type':'application/json','idempotency-key':key,authorization:'Bearer '+bindings.RESEND_API_KEY},body:JSON.stringify({...mail,from:bindings.DELIVERY_EMAIL_FROM}),signal:AbortSignal.timeout(30000)});
      const result=await response.json();
      if (response.ok && (outlook?result.ok:result.id)) {state='accepted';error=null;provider=result.providerId||result.id||null;}
      else if (result?.status==='failed' || response.status>=400 && response.status<500 && response.status!==408) {state='failed';error='邮件服务未接受发送请求，可在认领记录中重发。';}
    } catch {}
    db.prepare('UPDATE stock_orders SET email_status=?,email_error=?,provider=? WHERE id=?').run(state,error,provider,o.id);
  }
  async function process(id) {
    const d1=await inventory();
    let o=get(id);
    if (o.state==='holding') {await allocate(d1,o);o=get(id);}
    if (o.state==='rejected') throw fault(409,'库存不足，本次认领未扣费。');
    if (!o.published) {
      await deliver(d1,o);o=get(id);
      await d1.prepare(`UPDATE warehouse_inventory SET email_status=?,email_error=?,email_provider_id=? WHERE id
        IN (SELECT id FROM warehouse_allocation_items WHERE order_id=?) AND email_status='unknown'`).bind(o.email_status,o.email_error,o.provider,id).run();
      db.prepare('UPDATE stock_orders SET published=1 WHERE id=?').run(id);
    }
    return {ok:true,claimed:o.quantity,recipientEmail:o.recipient,emailStatus:o.email_status,emailError:o.email_error,totalRaw:o.quantity*o.unit_raw};
  }
  function run(id) {
    if (!active.has(id)) active.set(id,process(id).finally(()=>active.delete(id)));
    return active.get(id);
  }
  async function recover() {
    const orders=db.prepare("SELECT id FROM stock_orders WHERE state IN ('holding','fulfilled') AND published=0 ORDER BY created LIMIT 20").all();
    for (const order of orders) await run(order.id).catch(()=>{});
  }
  async function route(req,res,url,user) {
    if (!['/api/warehouse','/api/warehouse/claim'].includes(url.pathname)) return false;
    if (user.role==='customer') return send(res,403,{error:'此库存仅向员工开放。'});
    try {
      if (url.pathname==='/api/warehouse' && req.method==='GET') {
        const result=await mf.dispatchFetch(new URL('/api/warehouse',config.origin).href,{headers:trustedHeaders({},user)});
        const data=await result.json();
        if (!result.ok) return send(res,result.status,data);
        data.batches=await Promise.all(data.batches.map(async item=>{
          try{return {...item,...await price(item.unitPrice,item.currency)};}
          catch {return {...item,retailUnitRaw:null,priceLabel:'暂不可认领',rateNote:'无法确认此批次售价'};}
        }));
        return send(res,200,data);
      }
      if (url.pathname!=='/api/warehouse/claim' || req.method!=='POST') return send(res,405,{error:'请求方式不支持。'});
      if (!origins.has(req.headers.origin) || !/^application\/json\b/i.test(req.headers['content-type']||'')) throw fault(403,'请在本站完成认领。');
      const fields=await body(req);
      if (!fields || !uuid.test(fields.requestId) || !uuid.test(fields.batchId) || !Number.isInteger(fields.quantity) ||
          fields.quantity<1 || fields.quantity>100 || !Number.isSafeInteger(fields.quotedUnitRaw) || fields.quotedUnitRaw<0 ||
          !emailValid(fields.recipientEmail)) throw fault(400,'请刷新库存，核对售价、数量和接收邮箱。');
      fields.recipientEmail=fields.recipientEmail.trim().toLowerCase();
      const id='stock:'+user.id+':'+fields.requestId;
      await reserve(user,fields,id);
      // An overlapping request with the same key must still match the committed payload.
      const order=get(id);
      if (order.batch!==fields.batchId || order.quantity!==fields.quantity || order.recipient!==fields.recipientEmail || order.unit_raw!==fields.quotedUnitRaw) throw fault(409,'认领请求与原订单不符。');
      return send(res,200,await run(id));
    }catch(err){return send(res,err.status||err.statusCode||503,{error:err.status||err.statusCode?err.message:'认领状态待核对，请使用原请求重试。'});}
  }
  return {route,recover};
}
