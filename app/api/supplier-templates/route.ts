import { env } from "cloudflare:workers";
import { indexIntroductions, type TemplateIntroduction } from "@/lib/template-introduction";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { ADDRS_CATALOG_URL, getAddrsSnapshot, normalizeAddrsCatalog, type SupplierTemplateCatalog } from "@/lib/addrs-catalog";

export const dynamic = "force-dynamic";

let cached: SupplierTemplateCatalog | null = null;
let expiresAt = 0;
let pending: Promise<SupplierTemplateCatalog> | null = null;

let liveIntroductions = new Map<number, TemplateIntroduction>();
let savedIntroductions: Map<number, TemplateIntroduction> | undefined;
let lastAttempt = 0;

async function refreshCatalog(): Promise<SupplierTemplateCatalog> {
  lastAttempt = Date.now();
  try {
    const response = await fetch(ADDRS_CATALOG_URL, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8000),
      redirect: "error",
    });
    if (!response.ok) throw new Error(`原站返回 ${response.status}`);
    const raw = await response.json();
    const result: SupplierTemplateCatalog = { ...normalizeAddrsCatalog(raw), mode: "live" };
    liveIntroductions = indexIntroductions(raw);
    cached = result;
    expiresAt = Date.now() + 10 * 60 * 1000;
    return result;
  } catch {
    const fallback = cached || getAddrsSnapshot();
    return { ...fallback, notice: "原站实时目录暂时不可用，当前显示最近一次核对的真实目录。" };
  }
}

function refreshOnce() {
  if (!pending) pending = refreshCatalog().finally(() => { pending = null; });
  return pending;
}

export async function GET(request: Request) {
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
      else if (expiresAt <= Date.now() && Date.now() - lastAttempt > 30_000) await refreshOnce();
    }
    const intro = liveIntroductions.get(id) || savedIntroductions.get(id);
    if (intro) return Response.json(intro, { headers });
    const missing = cached !== null && expiresAt > Date.now();
    return Response.json({ error: missing ? "未找到此模板的官方介绍" : "官方介绍暂时无法读取" }, { status: missing ? 404 : 503, headers });
  }
  const refresh = params.get("refresh") === "1";
  if (!refresh) return Response.json(cached && expiresAt > Date.now() ? cached : getAddrsSnapshot(), {
    headers: { "cache-control": "private, no-store" },
  });
  return Response.json(await refreshOnce(), { headers: { "cache-control": "private, no-store" } });
}
