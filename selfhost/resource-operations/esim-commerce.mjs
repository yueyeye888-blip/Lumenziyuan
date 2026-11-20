export const paymentSchema = db => db.prepare(`CREATE TABLE IF NOT EXISTS esim_commerce_payments (
  payment_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, product_cost INTEGER NOT NULL,
  retail_amount INTEGER NOT NULL, settled INTEGER NOT NULL DEFAULT 0
)`);

// Direct supplier settlement still tracks the supplier cost for pending capacity, with no wallet leg.
export function paymentIntent(db, key, userId, cost, amount) {
  return db.prepare('INSERT INTO esim_commerce_payments(payment_id,user_id,product_cost,retail_amount) VALUES(?,?,?,?)')
    .bind(key,userId,cost,amount);
}

export const getPayment = (db,key) => db.prepare('SELECT * FROM esim_commerce_payments WHERE payment_id=?').bind(key).first();

// The order receipt is committed first. A crash between D1 and the wallet is replayable
// because capture/release uses the durable vendor transaction ID as its idempotency key.
export async function settlePayment(db,wallet,key) {
  const payment = await db.prepare(`SELECT p.*,COALESCE(b.status,r.status) AS status
    FROM esim_commerce_payments p LEFT JOIN esim_purchase_orders b ON b.id=p.payment_id
    LEFT JOIN esim_renewal_lines r ON r.id=p.payment_id WHERE p.payment_id=? AND p.settled=0`).bind(key).first();
  if (!payment) return;
  const accepted = ['allocating','ready','succeeded'].includes(payment.status);
  const released = ['rejected','not_sent'].includes(payment.status);
  if (!accepted && !released) return;
  if (payment.retail_amount) {
    if (accepted) wallet.capture(payment.user_id,key);
    else wallet.release(payment.user_id,key);
  }
  await db.prepare('UPDATE esim_commerce_payments SET settled=1 WHERE payment_id=?').bind(key).run();
}

export async function settlePendingPayments(db,wallet) {
  const {results} = await db.prepare(`SELECT payment_id FROM esim_commerce_payments p
    LEFT JOIN esim_purchase_orders b ON b.id=p.payment_id LEFT JOIN esim_renewal_lines r ON r.id=p.payment_id
    WHERE p.settled=0 AND COALESCE(b.status,r.status) IN ('allocating','ready','succeeded','rejected','not_sent')`).all();
  for (const row of results) await settlePayment(db,wallet,row.payment_id);
}

export async function recoverPayments(db,wallet) {
  await db.prepare("UPDATE esim_purchase_orders SET status='rejected',error='服务重启前未提交，请重新下单。' WHERE status='preparing'").run();
  await settlePendingPayments(db,wallet);
}

// A pending order may already have reached the supplier. Reserve its cost conservatively.
export async function supplierAvailable(db,balance) {
  const {total} = await db.prepare(`SELECT COALESCE(SUM(COALESCE(p.product_cost,x.amount)),0) AS total
    FROM (SELECT id,amount FROM esim_purchase_orders WHERE status IN ('preparing','submitting','uncertain')
      UNION ALL SELECT id,amount FROM esim_renewal_lines WHERE status IN ('queued','submitting','uncertain')) x
    LEFT JOIN esim_commerce_payments p ON p.payment_id=x.id`).first();
  return Math.max(0,balance-total);
}
