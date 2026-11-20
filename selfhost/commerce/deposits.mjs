import { randomInt, randomUUID } from 'node:crypto';
import { chains, createChainReader, receivingAddress } from './usdt-chain.mjs';

const minutes = (n) => n * 60000;
const failure = (status, message) => Object.assign(new Error(message), { status, statusCode: status });
const stamp = (ms) => new Date(ms).toISOString();
const ids = Object.keys(chains);
const waitingMs = minutes(30);
const chainScale = (network) => 10n ** BigInt(chains[network].decimals);
const walletUnitsPerCent = 100;
function principalMinor(value) {
  const match = /^(0|[1-9]\d{0,11})(?:\.(\d{1,2}))?$/.exec(String(value ?? ''));
  if (!match) return null;
  const minor = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
  return Number.isSafeInteger(minor * walletUnitsPerCent) ? minor : null;
}
function amountText(units, network, minimumDecimals = 0) {
  const scale = chainScale(network);
  const places = (BigInt(units) % scale).toString().padStart(chains[network].decimals, '0').replace(/0+$/, '').padEnd(minimumDecimals, '0');
  return (BigInt(units) / scale).toString() + (places ? '.' + places : '');
}

export function createDeposits({ db, config = {}, credit, fetchImpl = fetch, now = Date.now }) {
  if (typeof credit !== 'function') throw new Error('充值需要同步的余额入账方法');
  db.exec(`CREATE TABLE IF NOT EXISTS deposit_orders (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, request_id TEXT NOT NULL, network TEXT NOT NULL,
    address TEXT NOT NULL, recipient TEXT NOT NULL, principal INTEGER NOT NULL, fraction TEXT NOT NULL, mode TEXT NOT NULL,
    units TEXT NOT NULL, start_block INTEGER NOT NULL, created_ms INTEGER NOT NULL, expires_ms INTEGER NOT NULL,
    credited_hash TEXT, credited_index INTEGER, credited_principal INTEGER, UNIQUE(user_id, request_id), UNIQUE(network, recipient, units));
    CREATE INDEX IF NOT EXISTS deposit_by_user ON deposit_orders(user_id,created_ms);
    CREATE INDEX IF NOT EXISTS deposit_network_watch ON deposit_orders(network,start_block);
    CREATE TABLE IF NOT EXISTS deposit_request_aliases (user_id TEXT NOT NULL, request_id TEXT NOT NULL,
      order_id TEXT NOT NULL, PRIMARY KEY(user_id,request_id));
    CREATE TABLE IF NOT EXISTS deposit_cursors (network TEXT PRIMARY KEY, height INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS deposit_events (
      network TEXT NOT NULL, tx_hash TEXT NOT NULL, log_index INTEGER NOT NULL, order_id TEXT, address TEXT NOT NULL,
      units TEXT NOT NULL, block_number INTEGER NOT NULL, block_time INTEGER NOT NULL, disposition TEXT NOT NULL,
      PRIMARY KEY(network,tx_hash,log_index));
    CREATE INDEX IF NOT EXISTS deposit_order_events ON deposit_events(order_id);
    CREATE TABLE IF NOT EXISTS deposit_resolutions (
      network TEXT NOT NULL, tx_hash TEXT NOT NULL, log_index INTEGER NOT NULL, action TEXT NOT NULL,
      user_id TEXT, principal INTEGER, order_id TEXT, actor TEXT NOT NULL, note TEXT NOT NULL, resolved_ms INTEGER NOT NULL,
      PRIMARY KEY(network,tx_hash,log_index));
    CREATE INDEX IF NOT EXISTS deposit_historical_amount ON deposit_events(network,address,units);
    CREATE TABLE IF NOT EXISTS deposit_seen (
      order_id TEXT PRIMARY KEY, tx_hash TEXT NOT NULL, units TEXT NOT NULL, block_number INTEGER NOT NULL);`);

  const readers = new Map(),
    pools = new Map(),
    modes = new Map(),
    errors = new Map();
  for (const id of ids) {
    const options = config.networks?.[id];
    if (!options?.rpcUrl) continue;
    try {
      const pool = new Map();
      for (const value of options.addresses ?? []) pool.set(receivingAddress(id, value), value);
      const mode = options.mode ?? 'unique';
      if (!['unique', 'shared'].includes(mode) || (mode === 'shared' && pool.size !== 1))
        throw new Error('共享模式每链需要一个收款地址');
      modes.set(id, mode);
      pools.set(id, pool);
      readers.set(id, createChainReader({ network: id, config: options, fetchImpl }));
    } catch (err) {
      errors.set(id, err.message);
    }
  }
  const query = db.prepare(`SELECT o.*, s.tx_hash pending_hash, s.units pending_units,
    (SELECT e.units FROM deposit_events e WHERE e.order_id=o.id AND e.tx_hash=o.credited_hash AND e.log_index=o.credited_index LIMIT 1) credited_units,
    (SELECT e.tx_hash FROM deposit_events e WHERE e.order_id=o.id AND e.disposition!='credited' ORDER BY e.block_number DESC,e.log_index DESC LIMIT 1) review_hash,
    (SELECT e.units FROM deposit_events e WHERE e.order_id=o.id AND e.disposition!='credited' ORDER BY e.block_number DESC,e.log_index DESC LIMIT 1) review_units
    FROM deposit_orders o LEFT JOIN deposit_seen s ON s.order_id=o.id WHERE o.user_id=? AND o.id=?`);
  const byRequest = db.prepare(`SELECT * FROM deposit_orders WHERE user_id=? AND (request_id=? OR id=(
    SELECT order_id FROM deposit_request_aliases WHERE user_id=? AND request_id=?)) LIMIT 1`);
  const byAmount = db.prepare('SELECT * FROM deposit_orders WHERE network=? AND recipient=? AND units=?');
  const uniqueOrder = db.prepare("SELECT * FROM deposit_orders WHERE network=? AND recipient=? AND mode='unique'");
  function match(network, event) {
    return byAmount.get(network, event.receiver, event.units) ?? uniqueOrder.get(network, event.receiver);
  }
  const checkpoint = db.prepare('SELECT height FROM deposit_cursors WHERE network=?');
  function transaction(operation) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  function get(userId, id) {
    const row = query.get(userId, id);
    if (!row) return null;
    const txHash = row.credited_hash ?? row.pending_hash ?? row.review_hash ?? null;
    const actual = row.credited_units ?? row.pending_units ?? row.review_units;
    const status = row.credited_hash
      ? 'credited'
      : row.pending_hash
        ? 'confirming'
        : row.review_hash
          ? 'review'
          : row.expires_ms <= now()
            ? 'expired'
            : 'pending';
    return {
      id: row.id,
      network: row.network,
      token: row.network === 'BSC' ? 'Binance-Peg USDT' : 'USDT',
      tokenContract: row.network === 'TRON' ? 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' : chains[row.network].contract,
      address: row.address,
      amount: row.principal,
      expectedAmount: amountText(row.units, row.network, 2),
      paidAmount: actual == null ? null : amountText(actual, row.network),
      status,
      txHash,
      creditedAmount: row.credited_principal ?? null,
      createdAt: stamp(row.created_ms),
      expiresAt: stamp(row.expires_ms),
    };
  }
  function list(userId) {
    return db
      .prepare('SELECT id FROM deposit_orders WHERE user_id=? ORDER BY created_ms DESC LIMIT 100')
      .all(userId)
      .map((row) => get(userId, row.id));
  }
  function unused(id) {
    const pool = [...(pools.get(id) ?? [])];
    const hasOrders = db.prepare('SELECT 1 FROM deposit_orders WHERE network=? AND recipient=? LIMIT 1');
    return pool.filter(([key]) => (modes.get(id) === 'shared' ? !uniqueOrder.get(id, key) : !hasOrders.get(id, key)));
  }
  function quote(network, receiver, minor, mode) {
    const scale = chainScale(network);
    const base = BigInt(minor) * (scale / 100n);
    const prior = db.prepare('SELECT 1 FROM deposit_orders WHERE network=? AND recipient=? AND units=?');
    const seen = db.prepare('SELECT 1 FROM deposit_events WHERE network=? AND address=? AND units=? LIMIT 1');
    const existing =
      mode === 'shared'
        ? new Set(
            db
              .prepare('SELECT fraction FROM deposit_orders WHERE network=? AND recipient=? AND principal=?')
              .all(network, receiver, minor / 100)
              .map((row) => row.fraction)
          )
        : new Set();
    for (let digits = 2; digits <= 6; digits++) {
      const max = 9 * 10 ** (digits - 2) + 1,
        start = randomInt(1, max);
      for (let offset = 0; offset < max - 1; offset++) {
        const n = 1 + ((start - 1 + offset) % (max - 1));
        if (digits > 2 && n % 10 === 0) continue;
        const fraction = String(n).padStart(digits, '0');
        if (existing.has(fraction)) continue;
        const units = base + BigInt(n) * 10n ** BigInt(chains[network].decimals - digits);
        if (units % scale === 0n) continue;
        if (!prior.get(network, receiver, units.toString()) && !seen.get(network, receiver, units.toString()))
          return { fraction, units: units.toString() };
      }
    }
    throw failure(503, '这个金额的尾数已用完，请选择其他金额。');
  }
  function networks() {
    return ids.map((id) => ({
      id,
      mode: modes.get(id) ?? 'unique',
      label: chains[id].label,
      enabled: readers.has(id) && !errors.has(id) && unused(id).length > 0,
    }));
  }
  function health() {
    return networks().map((info) => ({
      ...info,
      remainingAddresses: unused(info.id).length,
      lastFinalizedBlock: checkpoint.get(info.id)?.height ?? null,
      error: errors.get(info.id) ?? null,
    }));
  }
  async function create({ userId, network, amount, requestId }) {
    if (
      typeof userId !== 'string' ||
      !userId ||
      typeof requestId !== 'string' ||
      !/^[a-z0-9_-]{8,100}$/i.test(requestId)
    )
      throw failure(400, '缺少有效的充值请求编号。');
    const minor = principalMinor(amount);
    if (!ids.includes(network) || minor === null || minor < 500)
      throw failure(400, '请选择充值网络并输入至少 5 U 的金额，最多两位小数。');
    const principal = minor / 100;
    function existing() {
      // Existing aliases from earlier versions still identify the same order on retry.
      const prior = byRequest.get(userId, requestId, userId, requestId);
      if (!prior) return null;
      if (prior.network !== network || principalMinor(prior.principal) !== minor)
        throw failure(409, '请求编号已用于其他充值。');
      return get(userId, prior.id);
    }
    const prior = existing();
    if (prior) return prior;
    const reader = readers.get(network);
    if (!reader || !unused(network).length) throw failure(503, '此网络的收款地址暂不可用，请联系管理员。');
    const [probe] = unused(network)[0];
    let heads;
    try {
      heads = await reader.heads();
      if (
        Math.abs(now() / 1000 - heads.latest.timestamp) > 240 ||
        Math.abs(now() / 1000 - heads.finalized.timestamp) > 3600
      )
        throw new Error('RPC 节点长时间未同步');
      await reader.read(heads.finalized.number, heads.finalized.number, [probe]);
      errors.delete(network);
    } catch (err) {
      errors.set(network, err.message);
      throw failure(503, '该网络的链上查询暂不可用，请稍后再试。');
    }
    return transaction(() => {
      const duplicate = existing();
      if (duplicate) return duplicate;
      const available = unused(network);
      if (!available.length) throw failure(503, '此网络的收款地址已用完。');
      const [recipient, address] = available[0],
        mode = modes.get(network),
        id = randomUUID(),
        created = now();
      const { fraction, units } = quote(network, recipient, minor, mode);
      db.prepare('INSERT OR IGNORE INTO deposit_cursors VALUES(?,?)').run(network, heads.finalized.number);
      db.prepare(
        `INSERT INTO deposit_orders(id,user_id,request_id,network,address,recipient,principal,fraction,mode,units,start_block,created_ms,expires_ms)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(
        id,
        userId,
        requestId,
        network,
        address,
        recipient,
        principal,
        fraction,
        mode,
        units,
        heads.latest.number + 1,
        created,
        created + waitingMs
      );
      return get(userId, id);
    });
  }
  function reconcile(network, event) {
    const row = match(network, event);
    let disposition = 'credited';
    if (!row || event.number < row.start_block) disposition = 'unmatched';
    else if (row.credited_hash) disposition = 'extra';
    else if (event.timestamp < Math.floor(row.created_ms / 1000) || event.timestamp * 1000 > row.expires_ms)
      disposition = 'outside_window';
    else if (BigInt(event.units) !== BigInt(row.units)) disposition = 'amount_mismatch';
    const inserted = db
      .prepare('INSERT OR IGNORE INTO deposit_events VALUES(?,?,?,?,?,?,?,?,?)')
      .run(
        network,
        event.txHash,
        event.logIndex,
        disposition === 'unmatched' ? null : row.id,
        event.receiver,
        event.units,
        event.number,
        event.timestamp,
        disposition
      );
    if (!inserted.changes || disposition !== 'credited') return;
    const result = credit({
      userId: row.user_id,
      amountRaw: principalMinor(row.principal) * walletUnitsPerCent,
      reference: 'deposit:' + row.id,
      note: network + ' USDT ' + event.txHash,
    });
    if (result && typeof result.then === 'function') throw new Error('充值入账必须同步完成');
    db.prepare('UPDATE deposit_orders SET credited_hash=?, credited_index=?, credited_principal=? WHERE id=?').run(
      event.txHash,
      event.logIndex,
      row.principal,
      row.id
    );
  }
  async function follow(network, reader) {
    const last = checkpoint.get(network);
    const { latest, finalized } = await reader.heads();
    const shared = modes.get(network) === 'shared' ? [...pools.get(network).keys()] : [];
    if (!last) {
      const first = unused(network)[0]?.[0];
      if (first) await reader.read(finalized.number, finalized.number, [first]);
      // Only new blocks are relevant on initial configuration. Later polls always resume the durable cursor.
      if (shared.length) db.prepare('INSERT OR IGNORE INTO deposit_cursors VALUES(?,?)').run(network, finalized.number);
      return;
    }
    const activeRecipients = db.prepare(
      'SELECT DISTINCT recipient FROM deposit_orders WHERE network=? AND start_block<=?'
    );
    function recipientsThrough(n) {
      return [...new Set([...shared, ...activeRecipients.all(network, n).map((row) => row.recipient)])];
    }
    let height = last.height;
    // Checkpoint each bounded range. An outage resumes from the last committed height.
    for (let step = 0; step < 12 && height < finalized.number; step++) {
      const to = Math.min(height + reader.span, finalized.number);
      const events = await reader.read(height + 1, to, recipientsThrough(to));
      transaction(() => {
        const current = checkpoint.get(network).height;
        if (current !== height) return;
        for (const event of events) reconcile(network, event);
        db.prepare(
          'DELETE FROM deposit_seen WHERE block_number<=? AND order_id IN (SELECT id FROM deposit_orders WHERE network=?)'
        ).run(to, network);
        db.prepare('UPDATE deposit_cursors SET height=? WHERE network=?').run(to, network);
      });
      height = checkpoint.get(network).height;
    }
    if (height !== finalized.number || latest.number - height > 1500) return;
    // Unfinalized observations are disposable and never change the balance.
    const seen = [];
    for (let from = height + 1; from <= latest.number; from += reader.span) {
      const to = Math.min(latest.number, from + reader.span - 1);
      seen.push(...(await reader.read(from, to, recipientsThrough(to))));
    }
    transaction(() => {
      if (checkpoint.get(network).height !== height) return;
      db.prepare('DELETE FROM deposit_seen WHERE order_id IN (SELECT id FROM deposit_orders WHERE network=?)').run(
        network
      );
      for (const event of seen) {
        const order = match(network, event);
        if (order && !order.credited_hash && event.number >= order.start_block) {
          db.prepare('INSERT OR IGNORE INTO deposit_seen VALUES(?,?,?,?)').run(
            order.id,
            event.txHash,
            event.units,
            event.number
          );
        }
      }
    });
  }
  let interval, running;
  function poll() {
    if (!running)
      running = Promise.all(
        [...readers].map(async ([network, reader]) => {
          try {
            if (modes.get(network) === 'shared' || checkpoint.get(network) || errors.has(network))
              await follow(network, reader);
            errors.delete(network);
          } catch (err) {
            errors.set(network, err.message);
          }
        })
      ).finally(() => {
        running = null;
      });
    return running;
  }
  function start() {
    if (!interval) {
      void poll();
      interval = setInterval(poll, 12000);
      interval.unref();
    }
  }
  function stop() {
    clearInterval(interval);
    interval = null;
    return running;
  }
  function reviews(includeResolved = false) {
    return db
      .prepare(
        `SELECT e.network,e.tx_hash txHash,e.log_index logIndex,e.order_id orderId,o.user_id userId,
      COALESCE(o.address,(SELECT d.address FROM deposit_orders d WHERE d.network=e.network AND d.recipient=e.address LIMIT 1),e.address) address,
      e.units,e.block_number blockNumber,e.block_time blockTime,e.disposition reason,r.action,r.actor,r.note,
      r.user_id creditedUserId,r.principal creditedPrincipal,r.resolved_ms resolvedMs
      FROM deposit_events e LEFT JOIN deposit_orders o ON o.id=e.order_id
      LEFT JOIN deposit_resolutions r ON r.network=e.network AND r.tx_hash=e.tx_hash AND r.log_index=e.log_index
      WHERE e.disposition!='credited' AND (? OR r.action IS NULL)
      ORDER BY e.block_time DESC,e.log_index DESC LIMIT 200`
      )
      .all(includeResolved ? 1 : 0)
      .map(({ units, ...row }) => ({ ...row, paidAmount: amountText(units, row.network) }));
  }
  function resolve({ network, txHash, logIndex, action, userId, principal, orderId, actor, note }) {
    if (
      !ids.includes(network) ||
      typeof txHash !== 'string' ||
      !/^0x[0-9a-f]{64}$/i.test(txHash) ||
      !Number.isSafeInteger(logIndex) ||
      logIndex < 0 ||
      !['credit', 'acknowledge'].includes(action)
    )
      throw failure(400, '待核对记录有误。');
    if (typeof actor !== 'string' || !actor || typeof note !== 'string' || !note.trim() || note.length > 500)
      throw failure(400, '请填写核对说明（最多 500 字）。');
    txHash = txHash.toLowerCase();
    return transaction(() => {
      let minor = null;
      const event = db
        .prepare('SELECT * FROM deposit_events WHERE network=? AND tx_hash=? AND log_index=?')
        .get(network, txHash, logIndex);
      if (!event) throw failure(404, '未找到已确认的转账事件。');
      if (event.disposition === 'credited') throw failure(409, '该转账已经自动入账。');
      if (action === 'credit') {
        minor = principalMinor(principal);
        if (
          typeof userId !== 'string' ||
          !userId ||
          !minor ||
          BigInt(minor) * (chainScale(network) / 100n) > BigInt(event.units)
        )
          throw failure(400, '请选择接收账号，入账本金须大于 0、最多两位小数，且不可超过收到的 USDT。');
        principal = minor / 100;
      } else {
        userId = null;
        principal = null;
      }
      const previous = db
        .prepare('SELECT * FROM deposit_resolutions WHERE network=? AND tx_hash=? AND log_index=?')
        .get(network, txHash, logIndex);
      const linkedId = event.order_id ?? orderId ?? null;
      if (orderId && event.order_id && orderId !== event.order_id) throw failure(409, '此笔转账已经对应另一笔订单。');
      if (previous) {
        if (
          previous.action !== action ||
          previous.user_id !== userId ||
          previous.principal !== principal ||
          previous.order_id !== linkedId
        )
          throw failure(409, '该转账已经由管理员处理。');
        return { action, orderId: linkedId, userId, principal, alreadyResolved: true };
      }
      if (action === 'credit') {
        if (linkedId) {
          const order = db.prepare('SELECT * FROM deposit_orders WHERE id=?').get(linkedId);
          if (!order || order.user_id !== userId || order.network !== network || order.recipient !== event.address)
            throw failure(409, '所选订单的账号、链或收款地址不符。');
          if (order.credited_hash) throw failure(409, '该订单已经入账。');
          if (minor > principalMinor(order.principal)) throw failure(409, '入账金额超过所选订单本金。');
          db.prepare(
            'UPDATE deposit_orders SET credited_hash=?, credited_index=?, credited_principal=? WHERE id=?'
          ).run(txHash, logIndex, principal, linkedId);
        }
        const reference = linkedId
          ? 'deposit:' + linkedId
          : 'deposit-manual:' + network + ':' + txHash + ':' + logIndex;
        const result = credit({
          userId,
          amountRaw: minor * walletUnitsPerCent,
          reference,
          actor,
          note: '管理员核对 ' + network + ' ' + txHash,
        });
        if (result && typeof result.then === 'function') throw new Error('充值入账必须同步完成');
        db.prepare('UPDATE deposit_events SET order_id=? WHERE network=? AND tx_hash=? AND log_index=?').run(
          linkedId,
          network,
          txHash,
          logIndex
        );
      }
      db.prepare('INSERT INTO deposit_resolutions VALUES(?,?,?,?,?,?,?,?,?,?)').run(
        network,
        txHash,
        logIndex,
        action,
        userId,
        principal,
        linkedId,
        actor,
        note.trim(),
        now()
      );
      return { action, orderId: linkedId, userId, principal, alreadyResolved: false };
    });
  }
  return { networks, health, create, get, list, reviews, resolve, start, stop, poll };
}
