export class StatusQueryError extends Error {
  constructor(message, status = 0) { super(message); this.status = status; }
}

export async function readStatusJson(url, signal) {
  const response = await fetch(url, { method: "GET", cache: "no-store", signal });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = response.status === 401 ? "登录已失效，请重新登录后查询" : response.status === 403 ? "当前账号无权查看这条记录" : response.status === 404 ? "没有找到这条记录，请核对订单链接" : data?.error || "状态服务暂时不可用";
    throw new StatusQueryError(message, response.status);
  }
  if (!data || typeof data !== "object") throw new StatusQueryError("服务器返回了无效状态，请稍后重新查询");
  return data;
}

/**
 * Queries only: this poller never submits, requeues or changes an order.
 * @template T
 * @param {{load: (signal: AbortSignal) => Promise<T>, onData: (value: T) => void, onError: (cause: StatusQueryError) => void, onBusy?: (busy: boolean) => void, isTerminal?: (value: T) => boolean, intervalMs?: number, timeoutMs?: number, visible?: () => boolean}} options
 */
export function createStatusPoller({ load, onData, onError, onBusy = () => {}, isTerminal = () => false, intervalMs = 5000, timeoutMs = 8000, visible = () => true }) {
  let stopped = false, busy = false, terminal = false, blocked = false, failures = 0;
  let timer, controller, cancel;
  function schedule() {
    if (stopped || terminal || blocked) return;
    timer = setTimeout(() => { if (visible()) void refresh(); else schedule(); }, Math.min(30000, intervalMs * 2 ** Math.min(failures, 3)));
  }
  async function refresh() {
    if (stopped || busy) return;
    clearTimeout(timer); busy = true; blocked = false;
    onBusy(true);
    const current = new AbortController(); controller = current;
    let deadline;
    const boundary = new Promise((_, reject) => {
      cancel = () => reject(new StatusQueryError("查询已取消"));
      deadline = setTimeout(() => { current.abort(); reject(new StatusQueryError("状态查询超过 8 秒，暂时无法确认进展；可重新查询，订单不会重复提交")); }, timeoutMs);
    });
    try {
      const value = await Promise.race([Promise.resolve().then(() => load(current.signal)), boundary]);
      if (stopped) return;
      failures = 0; terminal = isTerminal(value); onData(value);
    } catch (cause) {
      if (stopped) return;
      failures++; blocked = [401, 403, 404].includes(cause?.status);
      onError(cause instanceof StatusQueryError ? cause : new StatusQueryError(cause instanceof Error ? cause.message : "状态查询失败，请重新查询"));
    } finally {
      clearTimeout(deadline); cancel = null; controller = null; busy = false;
      if (!stopped) { onBusy(false); schedule(); }
    }
  }
  void refresh();
  return {
    refresh,
    resume() { if (!terminal && !blocked) void refresh(); },
    stop() { stopped = true; clearTimeout(timer); controller?.abort(); cancel?.(); },
  };
}
