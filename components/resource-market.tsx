"use client";

import { useEffect, useRef, useState } from "react";

const marketCategories = [
  { id: "esim", label: "eSIM 流量", icon: "esim", description: "按目的地、流量和有效期比较套餐。", action: "浏览套餐" },
  { id: "estonia-mobile", label: "爱沙尼亚手机号", icon: "phone", description: "查找爱沙尼亚 +372 手机号码。", action: "查看资源" },
  { id: "email", label: "邮箱账号", icon: "mail", description: "查看可认领的邮箱账号。", action: "查看资源" },
] as const;

type MarketCategory = (typeof marketCategories)[number];
export type MarketCategoryId = MarketCategory["id"];

function readMarketCategory(): MarketCategory | null {
  return marketCategories.find((category) => category.id === new URL(location.href).searchParams.get("market")) ?? null;
}

export function useResourceMarket(reopenMarket: () => void) {
  const [category, setCategory] = useState<MarketCategory | null>(null);
  const current = useRef(category);
  const open = useRef(reopenMarket);
  open.current = reopenMarket;

  useEffect(() => {
    const update = () => {
      const next = readMarketCategory();
      if (current.current !== next) {
        current.current = next;
        setCategory(next);
        open.current();
      }
    };
    update();
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);

  function choose(id: MarketCategoryId | null) {
    const next = marketCategories.find((entry) => entry.id === id) ?? null;
    const url = new URL(location.href);
    if (next) url.searchParams.set("market", next.id);
    else url.searchParams.delete("market");
    if (url.href !== location.href) history.pushState(history.state, "", url);
    current.current = next;
    setCategory(next);
    open.current();
  }
  return { category, choose };
}

type MarketAvailability = { state: "loading" | "unavailable" | "unlisted" | "sold-out" }
  | { state: "available"; count: number };

type StockCatalog = {
  listedCategories?: MarketCategoryId[];
  batches: { country?: string | null; category: string; productName: string; available: number }[];
};

function useMarketAvailability() {
  const [catalog, setCatalog] = useState<Partial<Record<MarketCategoryId, MarketAvailability>>>({});
  useEffect(() => {
    const request = new AbortController();
    const init = { cache: "no-store" as const, signal: request.signal };
    const update = (availability: Partial<Record<MarketCategoryId, MarketAvailability>>) => {
      if (!request.signal.aborted) setCatalog((current) => ({ ...current, ...availability }));
    };
    void fetch("/api/esim/packages?limit=1", init)
      .then(async (response) => {
        if (!response.ok) throw Error();
        const result = await response.json() as { connected: boolean; total: number };
        if (!result.connected || !Number.isSafeInteger(result.total) || result.total < 0) throw Error();
        update({ esim: result.total ? { state: "available", count: result.total } : { state: "sold-out" } });
      })
      .catch(() => update({ esim: { state: "unavailable" } }));
    void fetch("/api/warehouse?catalog=1", init)
      .then(async (response) => {
        if (!response.ok) throw Error();
        const inventory = await response.json() as StockCatalog;
        const available = (id: "estonia-mobile" | "email"): MarketAvailability => {
          const count = inventory.batches.reduce((total, batch) =>
            matchesMarketBatch(id, batch) ? total + batch.available : total, 0);
          if (count) return { state: "available", count };
          return { state: inventory.listedCategories?.includes(id) ? "sold-out" : "unlisted" };
        };
        update({ "estonia-mobile": available("estonia-mobile"), email: available("email") });
      })
      .catch(() => update({ "estonia-mobile": { state: "unavailable" }, email: { state: "unavailable" } }));
    return () => request.abort();
  }, []);
  return catalog;
}

const marketStatusCopy = {
  loading: "正在读取",
  unavailable: "暂不可用",
  unlisted: "待接入",
  "sold-out": "暂时缺货",
};

export function ResourceMarketDirectory({ choose }: { choose: (id: MarketCategoryId) => void }) {
  const availability = useMarketAvailability();
  return (
    <section className="lumen-market-directory" aria-labelledby="market-directory-title">
      <header>
        <h1 id="market-directory-title">资源市场</h1>
        <p>选购流量套餐、手机号码和邮箱账号。</p>
      </header>
      <div className="lumen-market-categories">
        {marketCategories.map((item) => {
          const status = availability[item.id] ?? { state: "loading" };
          return (
            <button
              type="button"
              className="lumen-market-category"
              data-category={item.id}
              onClick={() => choose(item.id)}
              key={item.id}
            >
              <span className="lumen-market-category-top">
                <span className={"lumen-category-icon lumen-category-" + item.icon} aria-hidden="true" />
                <span className="lumen-market-status" data-state={status.state} aria-live="polite">
                  {status.state === "available" ? (
                    <span className="lumen-market-status-count"><b>{status.count.toLocaleString()}</b><span>{item.id === "esim" ? "个套餐" : "个可用"}</span></span>
                  ) : marketStatusCopy[status.state]}
                </span>
              </span>
              <span className="lumen-market-category-copy">
                <strong>{item.label}</strong>
                <span>{item.description}</span>
              </span>
              <span className="lumen-market-category-action">
                <span>{item.action}</span><i aria-hidden="true" />
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function MarketCategoryHeader({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <header className="lumen-market-category-header">
      <button type="button" onClick={onBack}>全部分类</button>
      <h1>{label}</h1>
    </header>
  );
}

export function matchesMarketBatch(
  category: MarketCategoryId,
  batch: { country?: string | null; category: string; productName: string; marketCategories?: string[] },
) {
  if (Array.isArray(batch.marketCategories)) return batch.marketCategories.includes(category);
  const description = batch.category + " " + batch.productName;
  if (category === "email") {
    return /邮箱|邮件账号|電子郵箱|電子郵件|\be[ -]?mail\b|\bmailbox\b|gmail|outlook|hotmail|proton\s*mail|yahoo\s*mail/i.test(description);
  }
  return category === "estonia-mobile"
    && /手机|電話|电话|号码|號碼|phone|mobile|\+372|SIM\s*卡/i.test(description)
    && /爱沙尼亚|愛沙尼亞|Estonia|\+372|\bEE\b/i.test((batch.country || "") + " " + description);
}
