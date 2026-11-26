import { env } from "cloudflare:workers";
import { t as getChatGPTUser } from "./chatgpt-auth-CAwUFDgI.js";
import { t as ADDRS_CATALOG_URL, n as getAddrsSnapshot, r as normalizeAddrsCatalog } from "./addrs-catalog-CnRraqSq.js";
const fields = [
  ["机构/服务名称", "institution"],
  ["中文名称", "chineseName"],
  ["机构类型", "institutionType"],
  ["原文名称", "originalName"],
  ["国家 / 地区", "country"],
  ["可能使用地区", "possibleRegion"],
  ["文件类型", "fileType"],
  ["主要语言", "language"],
  ["货币", "currency"],
  ["展示账户/服务", "product"],
  ["展示内容", "content"],
  ["默认交付", "defaultOutput"]
];
const text = (value) => typeof value === "string" ? value.trim() : "";
function indexIntroductions(source) {
  const result = /* @__PURE__ */ new Map();
  const rows = source?.items;
  if (!Array.isArray(rows)) return result;
  for (const row of rows) {
    if (!Number.isSafeInteger(row?.publicId) || row.publicId < 1) continue;
    const facts = [];
    for (const [label, field] of fields) {
      const value = text(row[field]);
      if (value) facts.push([label, value]);
    }
    result.set(row.publicId, {
      id: row.publicId,
      facts,
      summary: text(row.summary),
      note: text(row.note),
      contentItems: Array.isArray(row.contentItems) ? row.contentItems.map(text).filter(Boolean) : []
    });
  }
  return result;
}
const dynamic = "force-dynamic";
let cached = null;
let expiresAt = 0;
let pending = null;
let liveIntroductions = /* @__PURE__ */ new Map();
let savedIntroductions;
let lastAttempt = 0;
async function refreshCatalog() {
  lastAttempt = Date.now();
  try {
    const response = await fetch(ADDRS_CATALOG_URL, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8e3),
      redirect: "error"
    });
    if (!response.ok) throw new Error(`原站返回 ${response.status}`);
    const raw = await response.json();
    const result = { ...normalizeAddrsCatalog(raw), mode: "live" };
    liveIntroductions = indexIntroductions(raw);
    cached = result;
    expiresAt = Date.now() + 10 * 60 * 1e3;
    return result;
  } catch {
    const fallback = cached || getAddrsSnapshot();
    return { ...fallback, notice: "原站实时目录暂时不可用，当前显示最近一次核对的真实目录。" };
  }
}
function refreshOnce() {
  if (!pending) pending = refreshCatalog().finally(() => {
    pending = null;
  });
  return pending;
}
async function GET(request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const requested = params.get("introduction");
  if (requested !== null) {
    const headers = { "cache-control": "private, no-store" };
    if (!/^[1-9]\d{0,9}$/.test(requested)) return Response.json({ error: "无效的模板编号" }, { status: 400, headers });
    const id = Number(requested);
    savedIntroductions ??= indexIntroductions(env.SUPPLIER_INTRODUCTION_CACHE);
    if (!liveIntroductions.has(id) && !savedIntroductions.has(id)) {
      if (pending) await pending;
      else if (expiresAt <= Date.now() && Date.now() - lastAttempt > 3e4) await refreshOnce();
    }
    const intro = liveIntroductions.get(id) || savedIntroductions.get(id);
    if (intro) return Response.json(intro, { headers });
    const missing = cached !== null && expiresAt > Date.now();
    return Response.json({ error: missing ? "未找到此模板的官方介绍" : "官方介绍暂时无法读取" }, { status: missing ? 404 : 503, headers });
  }
  const refresh = params.get("refresh") === "1";
  if (!refresh) return Response.json(cached && expiresAt > Date.now() ? cached : getAddrsSnapshot(), {
    headers: { "cache-control": "private, no-store" }
  });
  return Response.json(await refreshOnce(), { headers: { "cache-control": "private, no-store" } });
}
export {
  GET,
  dynamic
};
