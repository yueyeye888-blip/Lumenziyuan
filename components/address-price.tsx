"use client";

import { useEffect, useState } from "react";

const addressPriceFormat = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 4 });

export function useAddressPrice(billed: boolean) {
  const [price, setPrice] = useState<string | null>(null);
  useEffect(() => {
    if (!billed) return;
    const request = new AbortController();
    fetch("/api/commerce/address/price", { cache: "no-store", signal: request.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const { priceRaw } = await response.json() as { priceRaw?: number };
        if (!request.signal.aborted && typeof priceRaw === "number" && Number.isSafeInteger(priceRaw) && priceRaw > 0) {
          setPrice(addressPriceFormat.format(priceRaw / 10000));
        }
      })
      .catch(() => {});
    return () => request.abort();
  }, [billed]);
  return price;
}

export function AddressPrice({ price }: { price: string | null }) {
  return (
    <section className="lumen-address-price" aria-label="地址证明生成费用">
      <div>
        <h3>地址证明生成费用</h3>
        <p>处理失败后，费用退回账户余额。</p>
      </div>
      <div className="lumen-address-price-amount" aria-live="polite">
        {!price && <span className="lumen-address-standard-label">标准价</span>}
        <strong>{price ?? "10"}</strong><span>U / 份</span>
        {price && price !== "10" && <small>标准价 10 U</small>}
      </div>
    </section>
  );
}
