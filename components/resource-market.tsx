"use client";

import { useEffect, useRef, useState } from "react";

const marketCategories = [
  { id: "esim", label: "eSIM 流量", icon: "esim", description: "按国家、流量和有效期比较套餐" },
  { id: "estonia-mobile", label: "爱沙尼亚手机号", icon: "phone", description: "查看爱沙尼亚 +372 手机号库存" },
  { id: "email", label: "邮箱", icon: "mail", description: "查看可认领的邮箱账号" },
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

export function ResourceMarketDirectory({ choose }: { choose: (id: MarketCategoryId) => void }) {
  return (
    <section className="lumen-market-directory" aria-labelledby="market-directory-title">
      <header>
        <h1 id="market-directory-title">资源市场</h1>
        <p>选择资源分类，查看套餐或可认领库存。</p>
      </header>
      <div className="lumen-market-categories">
        {marketCategories.map((item) => (
          <button type="button" className="lumen-market-category" onClick={() => choose(item.id)} key={item.id}>
            <span className={"lumen-category-icon lumen-category-" + item.icon} aria-hidden="true" />
            <strong>{item.label}</strong>
            <span>{item.description}</span>
          </button>
        ))}
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
  batch: { country?: string | null; category: string; productName: string },
) {
  const description = batch.category + " " + batch.productName;
  if (category === "email") {
    return /邮箱|邮件账号|電子郵箱|電子郵件|\be[ -]?mail\b|\bmailbox\b|gmail|outlook|hotmail|proton\s*mail|yahoo\s*mail/i.test(description);
  }
  return category === "estonia-mobile"
    && /手机|電話|电话|号码|號碼|phone|mobile|\+372|SIM\s*卡/i.test(description)
    && /爱沙尼亚|愛沙尼亞|Estonia|\+372|\bEE\b/i.test((batch.country || "") + " " + description);
}
