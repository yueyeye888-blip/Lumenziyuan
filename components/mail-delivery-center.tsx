"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CircleAlert, Download, Mail, RefreshCw, Search } from "lucide-react";
import { createStatusPoller, readStatusJson } from "@/lib/status-poller.mjs";
import { MAIL_KIND_OPTIONS, filterMailRecords, formatMailTime, mailKindLabel, mailRecordTimes } from "@/lib/mail-delivery-records.mjs";

type RecordItem = { id: string; name: string; kind: string; account: string | null; recipientEmail: string | null; createdAt: string | null; updatedAt?: string | null; error: string | null; delivery: { code: string; label: string; tone: string; detail: string } };
const tones: Record<string, string> = { success: "bg-emerald-50 text-emerald-800", info: "bg-blue-50 text-blue-800", warning: "bg-amber-50 text-amber-800", error: "bg-red-50 text-red-800" };
export default function MailDeliveryCenter() {
  const [records, setRecords] = useState<RecordItem[]>([]), [admin, setAdmin] = useState(false);
  const [error, setError] = useState(""), [loading, setLoading] = useState(true), [query, setQuery] = useState(""), [filter, setFilter] = useState("all");
  const [kind, setKind] = useState("all");
  const [updated, setUpdated] = useState("");
  const poller = useRef<ReturnType<typeof createStatusPoller> | null>(null);
  const refresh = () => void poller.current?.refresh();
  useEffect(() => {
    const current = createStatusPoller({
      load: async (signal: AbortSignal) => {
        const data = await readStatusJson("/api/mail-deliveries", signal) as { records?: RecordItem[]; viewer?: { isAdmin: boolean } };
        if (!Array.isArray(data.records) || !data.viewer) throw new Error("交付记录读取失败");
        return { records: data.records, viewer: data.viewer };
      },
      onData: (data: { records: RecordItem[]; viewer: { isAdmin: boolean } }) => { setRecords(data.records); setAdmin(data.viewer.isAdmin); setError(""); setUpdated(formatMailTime(new Date().toISOString())); setLoading(false); },
      onError: (cause: Error) => { setError(cause.message); setLoading(false); },
      intervalMs: 8000, visible: () => !document.hidden,
    });
    poller.current = current;
    const resume = () => { if (!document.hidden) current.resume(); };
    document.addEventListener("visibilitychange", resume);
    return () => { current.stop(); document.removeEventListener("visibilitychange", resume); poller.current = null; };
  }, []);
  const visible = useMemo(() => filterMailRecords(records, kind, filter, query), [records, kind, filter, query]);
  return <main className="min-h-screen bg-[#f6f8fc] px-4 py-8 text-[#243d64] sm:px-8"><div className="mx-auto max-w-6xl">
    <header className="flex flex-wrap items-center justify-between gap-4"><div><a href="/" className="mb-4 inline-flex items-center gap-2 text-sm text-slate-500"><ArrowLeft size={16} />返回工作台</a><h1 className="flex items-center gap-3 text-2xl font-semibold"><Mail />邮件交付记录</h1><p className="mt-2 text-sm text-slate-500">{admin ? "所有订单与资源的邮件交付记录" : "我的订单与资源交付记录"}</p></div><button onClick={() => void refresh()} className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-3 text-sm"><RefreshCw size={16} />刷新状态</button></header>
    <div className="mt-6 rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm leading-6 text-blue-900">“邮件服务已接受”表示发送请求已被接受，尚未确认收件人收到。请同时查看收件箱和垃圾邮箱。发送结果待确认时，请先核实，避免重复发送。</div>
    <div className="mt-6 flex flex-col gap-3 sm:flex-row"><label className="flex flex-1 items-center gap-2 rounded-xl border bg-white px-4"><Search size={17} /><span className="sr-only">搜索交付记录</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索资源、编号或邮箱" className="w-full bg-transparent py-3 text-sm outline-none" /></label><select aria-label="按资源类型筛选" value={kind} onChange={e => setKind(e.target.value)} className="rounded-xl border bg-white px-4 py-3 text-sm"><option value="all">全部类型</option>{MAIL_KIND_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select aria-label="按交付状态筛选" value={filter} onChange={e => setFilter(e.target.value)} className="rounded-xl border bg-white px-4 py-3 text-sm"><option value="all">全部状态</option><option value="pending">尚未发送</option><option value="accepted">邮件服务已接受</option><option value="unknown">结果待确认</option><option value="failed">发送失败</option><option value="delivered">已确认交付</option></select></div>
    {error && <div role="alert" className="mt-4 flex items-center gap-2 rounded-xl bg-red-50 p-4 text-sm text-red-800"><CircleAlert size={18} />{error}。当前列表可能尚未更新。</div>}
    <p className="my-4 text-xs text-slate-500">{loading ? "正在读取…" : `${visible.length} 条记录 · 自动检查状态${updated ? ` · 最近读取 ${updated}` : ""}`}</p>
    <div className="space-y-3">{visible.map(row => <article key={`${row.kind}-${row.id}`} className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex flex-wrap justify-between gap-3"><div><p className="text-xs text-slate-400">{mailKindLabel(row.kind)}</p><h2 className="mt-1 break-all font-semibold">{row.name}</h2></div><span className={`h-fit rounded-full px-3 py-1 text-xs ${tones[row.delivery.tone] || tones.warning}`}>{row.delivery.label}</span></div><p className="mt-3 break-all text-sm text-slate-500">接收邮箱：{row.recipientEmail || "未填写"}{admin && row.account ? ` · 提交账号：${row.account}` : ""}</p><div className="mt-3 flex flex-wrap gap-3 text-sm text-slate-500">{mailRecordTimes(row).map(([label, value]) => <div key={label}><span>{label}</span><span>{value}</span></div>)}</div><p className="mt-2 text-sm text-slate-500">{row.delivery.detail}</p>{row.error && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">处理提示：{row.error}</p>}{row.kind === "sample" && <a href={`/api/sample-documents/attachment?id=${encodeURIComponent(row.id)}`} className="mt-4 inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs"><Download size={14} />下载带水印的测试样张（SVG）</a>}</article>)}</div>
    {!loading && !visible.length && <div className="rounded-2xl border border-dashed bg-white px-5 py-14 text-center text-sm text-slate-500">{error ? "暂时无法读取交付记录" : "暂无符合条件的交付记录"}</div>}
  </div></main>;
}
