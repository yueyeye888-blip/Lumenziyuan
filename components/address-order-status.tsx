"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, CircleAlert, Clock3, LoaderCircle, MapPin, RefreshCw } from "lucide-react";
import { ORDER_STEPS, orderDisplay, orderStep, orderTime } from "@/lib/order-presentation.mjs";
import { createStatusPoller, readStatusJson, StatusQueryError } from "@/lib/status-poller.mjs";

type AddressOrder = {
  requestNo: string;
  templateName: string;
  subjectName: string;
  recipientEmail: string;
  status: string;
  statusMessage: string | null;
  externalOrderNo: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

const TERMINAL = new Set(["delivered", "failed"]);

export default function AddressOrderStatus({ requestNo }: { requestNo: string }) {
  const [order, setOrder] = useState<AddressOrder | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [loginRequired, setLoginRequired] = useState(false);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now);
  const poller = useRef<ReturnType<typeof createStatusPoller> | null>(null);

  useEffect(() => {
    setOrder(null); setError(""); setCheckedAt(null); setLoginRequired(false);
    const current = createStatusPoller({
      load: async (signal: AbortSignal) => {
        const data = await readStatusJson(`/api/address-orders/${encodeURIComponent(requestNo)}`, signal) as { order?: AddressOrder };
        if (!data.order || data.order.requestNo !== requestNo || typeof data.order.status !== "string") throw new StatusQueryError("服务器未返回有效的订单状态");
        return data.order;
      },
      onData: (value: AddressOrder) => { setOrder(value); setError(""); setLoginRequired(false); setCheckedAt(Date.now()); setNow(Date.now()); },
      onError: (cause: StatusQueryError) => { setError(cause.message); setLoginRequired(cause.status === 401); },
      onBusy: setBusy, isTerminal: (value: AddressOrder) => TERMINAL.has(value.status),
      visible: () => !document.hidden,
    });
    poller.current = current;
    const resume = () => { if (!document.hidden) current.resume(); };
    document.addEventListener("visibilitychange", resume);
    const clock = window.setInterval(() => { if (!document.hidden) setNow(Date.now()); }, 10000);
    return () => { current.stop(); document.removeEventListener("visibilitychange", resume); clearInterval(clock); poller.current = null; };
  }, [requestNo]);

  const currentStep = order ? orderStep(order.status) : 1;
  const display = useMemo(() => order ? orderDisplay(order, now) : null, [order, now]);
  const updated = order ? orderTime(order.updatedAt) : NaN;
  const refresh = () => void poller.current?.refresh();

  return <main className="min-h-screen bg-[radial-gradient(circle_at_top,#eef4ff_0,#f6f8fc_42%,#edf1f7_100%)] px-4 py-5 text-[#202938] sm:px-8 sm:py-8">
    <div className="mx-auto max-w-7xl">
      <header className="flex flex-col gap-4 rounded-[28px] border border-[#d5dfec] bg-white/90 px-5 py-5 shadow-[0_12px_35px_rgba(51,72,103,0.08)] sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <div className="flex items-center gap-4"><span className="flex size-12 items-center justify-center rounded-2xl bg-[#2169df] text-white"><MapPin size={28} fill="currentColor" /></span><div><p className="text-lg font-semibold sm:text-2xl">Yorke AI 地址订单</p><p className="mt-0.5 text-xs text-slate-400">订单处理状态实时更新</p></div></div>
        <a href="/" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[#ccd9ea] px-5 text-sm font-medium text-[#294a77]"><ArrowLeft size={17} />返回主页</a>
      </header>

      <section className="mt-5 rounded-[28px] border border-[#d5dfec] bg-white/90 p-5 shadow-[0_18px_50px_rgba(51,72,103,0.09)] sm:p-8">
        <p className="text-xs font-semibold tracking-[0.18em] text-slate-400">ORDER</p>
        <h1 className="mt-1 break-all text-2xl font-semibold sm:text-4xl">{order?.externalOrderNo || requestNo}</h1>
        {order?.externalOrderNo && <p className="mt-2 text-xs text-slate-400">内部编号：{requestNo}</p>}

        <div className="mt-8 grid grid-cols-5 gap-1 border-t border-slate-200 pt-7 sm:gap-4">
          {ORDER_STEPS.map((step, index) => {
            const number = index + 1;
            const active = number <= currentStep && order?.status !== "failed";
            return <div key={step} className="relative flex flex-col items-center text-center">
              {index > 0 && <span className={`absolute right-1/2 top-5 h-0.5 w-full ${active ? "bg-[#4b78dc]" : "bg-slate-200"}`} />}
              <span className={`relative z-10 flex size-10 items-center justify-center rounded-full text-sm font-semibold ${active ? "bg-[#4674df] text-white" : "bg-slate-100 text-slate-400"}`}>{number < currentStep && order?.status !== "failed" ? <Check size={17} /> : number}</span>
              <span className={`mt-3 text-[10px] font-medium sm:text-sm ${active ? "text-[#2367d7]" : "text-slate-400"}`}>{step}</span>
            </div>;
          })}
        </div>

        <div aria-live="polite" className={`mt-8 rounded-3xl border p-6 text-center sm:p-9 ${error || display?.tone === "error" ? "border-red-200 bg-red-50" : display?.tone === "warning" ? "border-amber-200 bg-amber-50" : "border-[#d9e3ef] bg-[#fbfcfe]"}`}>
          {!order && !error && <LoaderCircle className="mx-auto animate-spin text-[#4674df]" size={36} />}
          {error && <><CircleAlert className="mx-auto text-red-500" size={36} /><h2 className="mt-3 text-xl font-semibold text-red-800">暂时无法确认最新进展</h2><p className="mt-2 text-sm text-red-700">{error}</p>{loginRequired && <a href={`/signin-with-chatgpt?return_to=${encodeURIComponent(`/address-orders/${requestNo}`)}`} className="mt-4 inline-block rounded-xl bg-red-700 px-5 py-2.5 text-sm text-white">重新登录</a>}</>}
          {order && display && !error && <>
            {display.tone === "working" && <LoaderCircle className="mx-auto animate-spin text-[#4674df]" size={36} />}
            {display.tone === "ready" && <Check className="mx-auto rounded-full bg-emerald-100 p-2 text-emerald-700" size={42} />}
            {display.tone === "error" && <CircleAlert className="mx-auto text-red-500" size={38} />}
            {display.tone === "warning" && <Clock3 className="mx-auto text-amber-700" size={38} />}
            <h2 className="mt-3 text-xl font-semibold sm:text-3xl">{display.title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">{display.detail}</p>
          </>}
          <div className="mt-5 space-y-2 text-xs text-slate-500">
            {Number.isFinite(updated) && <p>最近状态更新时间：{new Date(updated).toLocaleString()}</p>}
            {checkedAt && <p>最近成功查询：{new Date(checkedAt).toLocaleTimeString()}{error ? "（当前显示的是上次读取的记录）" : ""}</p>}
            <button type="button" onClick={refresh} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-[#294a77] disabled:opacity-50"><RefreshCw size={15} className={busy ? "animate-spin" : ""} />{busy ? "正在查询…" : "重新查询状态"}</button>
            <p>查询只读取状态，不会重新提交、生成或付款。</p>
          </div>
        </div>

        {order && <div className="mt-5 grid overflow-hidden rounded-2xl border border-[#d5dfec] bg-white sm:grid-cols-3">
          {[['模版', order.templateName], ['姓名', order.subjectName], ['接收邮箱', order.recipientEmail]].map(([label, value], index) => <div key={label} className={`p-5 ${index ? "border-t border-[#d5dfec] sm:border-l sm:border-t-0" : ""}`}><p className="text-xs text-slate-400">{label}</p><p className="mt-2 break-words text-sm font-semibold text-[#1f3357] sm:text-base">{value}</p></div>)}
        </div>}
      </section>
      <p className="py-5 text-center text-xs text-slate-500">请保留当前订单网址；重新打开页面可查询已记录的状态，无需重复提交资料。</p>
    </div>
  </main>;
}
