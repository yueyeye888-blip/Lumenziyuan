export function fault(status, message) { return Object.assign(new Error(message), { status }); }

export function amountRaw(value) {
  const match = /^(0|[1-9]\d{0,7})(?:\.(\d{1,4}))?$/.exec(String(value ?? ''));
  if (!match) throw fault(400,'请输入正数金额，最多四位小数。');
  const amount = Number(match[1]) * 10000 + Number((match[2] || '').padEnd(4,'0'));
  if (!amount) throw fault(400,'金额必须大于零。');
  return amount;
}

export function createWallet(db) {
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS wallet_entries(
      reference TEXT PRIMARY KEY, user_id TEXT NOT NULL, delta INTEGER NOT NULL,
      note TEXT NOT NULL, actor TEXT, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS wallet_entries_owner ON wallet_entries(user_id,created_at);
    CREATE TABLE IF NOT EXISTS wallet_holds(
      reference TEXT PRIMARY KEY, user_id TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount>=0),
      state TEXT NOT NULL CHECK(state IN ('held','spent','released')), created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS wallet_holds_owner ON wallet_holds(user_id,state);`);
  const sum = db.prepare('SELECT coalesce(sum(delta),0) n FROM wallet_entries WHERE user_id=?');
  const pending = db.prepare("SELECT coalesce(sum(amount),0) n FROM wallet_holds WHERE user_id=? AND state='held'");
  const entry = db.prepare('SELECT * FROM wallet_entries WHERE reference=?');
  const hold = db.prepare('SELECT * FROM wallet_holds WHERE reference=?');
  function atomic(fn) {
    // Older supported Node 22 releases do not expose DatabaseSync.isTransaction.
    // A savepoint also works inside the deposit monitor's transaction on those releases.
    if (db.isTransaction === true) return fn();
    const savepoint = db.isTransaction === undefined;
    db.exec(savepoint ? 'SAVEPOINT wallet_atomic' : 'BEGIN IMMEDIATE');
    try {
      const result = fn();
      if (result && typeof result.then === 'function') throw new TypeError('余额变更必须同步执行。');
      db.exec(savepoint ? 'RELEASE wallet_atomic' : 'COMMIT');
      return result;
    } catch (error) {
      db.exec(savepoint ? 'ROLLBACK TO wallet_atomic; RELEASE wallet_atomic' : 'ROLLBACK');
      throw error;
    }
  }
  const valid = (user,key,amount) => {
    if (!user || !key || !Number.isSafeInteger(amount) || amount < 0) throw fault(400,'无效的账务记录。');
  };
  const balance = user => sum.get(user).n - pending.get(user).n;
  function credit({userId,amountRaw,reference,note,actor=null}) {
    return atomic(()=>{
      valid(userId,reference,amountRaw);
      if (amountRaw === 0) throw fault(400,'入账金额必须大于零。');
      const existing=entry.get(reference);
      if (existing) {
        if (existing.user_id!==userId || existing.delta!==amountRaw || existing.actor!==actor) throw fault(409,'操作编号已被其他交易使用。');
        return false;
      }
      if (!Number.isSafeInteger(sum.get(userId).n+amountRaw)) throw fault(409,'余额超出可记录的范围。');
      db.prepare('INSERT INTO wallet_entries VALUES(?,?,?,?,?,?)').run(reference,userId,amountRaw,note || '余额入账',actor,Date.now());
      return true;
    });
  }
  function reserve(user,key,amount) {
    return atomic(()=>{
      valid(user,key,amount);
      const h=hold.get(key);
      if (h) {
        if (h.user_id!==user || h.amount!==amount || h.state==='released') throw fault(409,'账务请求已结束或与原订单不符。');
        return;
      }
      if (balance(user)<amount) throw fault(402,'账户余额不足，请充值后再试。');
      db.prepare("INSERT INTO wallet_holds VALUES(?,?,?,'held',?)").run(key,user,amount,Date.now());
    });
  }
  function finish(user,key,capture,note = '订单消费') {
    return atomic(()=>{
      const h=hold.get(key);
      if (!h && !capture) return;
      if (!h || h.user_id!==user) throw fault(409,'没有找到对应的余额预留记录。');
      const next=capture?'spent':'released';
      if (h.state===next) return;
      if (h.state!=='held') throw fault(409,'这笔余额已完成结算。');
      if (capture) db.prepare('INSERT INTO wallet_entries VALUES(?,?,?,?,NULL,?)').run('spend:'+key,user,-h.amount,note,Date.now());
      db.prepare('UPDATE wallet_holds SET state=? WHERE reference=?').run(next,key);
    });
  }
  return { atomic,credit,reserve,balance,capture:(u,k,note)=>finish(u,k,true,note),release:(u,k)=>finish(u,k,false),
    snapshot:(user)=>({availableRaw:balance(user),heldRaw:pending.get(user).n,
      entries:db.prepare('SELECT reference,delta,note,created_at AS createdAt FROM wallet_entries WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100').all(user)}),
  };
}

// Old eSIM quota transactions remain the historical source for orders started before the migration.
export async function migrateQuotas(d1,wallet) {
  const rows=await d1.prepare(`SELECT q.user_id, SUM(q.amount) AS amount FROM quota_transactions q
    WHERE q.platform='eSIMAccess' AND NOT EXISTS(
      SELECT 1 FROM esim_purchase_orders p WHERE p.user_id=q.user_id AND p.status IN ('submitting','uncertain')
      AND NOT EXISTS(SELECT 1 FROM esim_commerce_payments c WHERE c.payment_id=p.id))
    AND NOT EXISTS(SELECT 1 FROM esim_renewal_lines r WHERE r.user_id=q.user_id AND r.status IN ('queued','submitting','uncertain')
      AND NOT EXISTS(SELECT 1 FROM esim_commerce_payments c WHERE c.payment_id=r.id))
    GROUP BY q.user_id HAVING SUM(q.amount)>0`).all();
  for(const r of rows.results) wallet.credit({userId:r.user_id,reference:'legacy-quota:'+r.user_id,amountRaw:r.amount,note:'原合伙人额度转入'});
}
