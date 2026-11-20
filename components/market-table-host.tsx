"use client";

import { useEffect, useRef, useState } from "react";

export type MarketTableOptions = {
  scope: string;
  scopeLabel: string;
  ids: string[] | null;
  query: string;
  favoriteIds: string[];
  toggleFavorite: (id: string) => void;
  resetQuery: () => void;
  openSecurity: () => void;
};

type MarketTableBinding = {
  update: (options: MarketTableOptions) => void;
  destroy: () => void;
};

declare global {
  interface Window {
    lumenMountMarket?: (host: HTMLElement) => MarketTableBinding;
  }
}

export function useMarketTable() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const ready = () => {
      if (typeof window.lumenMountMarket === "function") setEnabled(true);
    };
    ready();
    window.addEventListener("lumen:market-ready", ready);
    return () => window.removeEventListener("lumen:market-ready", ready);
  }, []);
  return enabled;
}

export function MarketTableHost(options: MarketTableOptions) {
  const container = useRef<HTMLDivElement>(null);
  const binding = useRef<MarketTableBinding | undefined>(undefined);
  useEffect(() => {
    if (container.current) binding.current = window.lumenMountMarket?.(container.current);
    return () => {
      binding.current?.destroy();
      binding.current = undefined;
    };
  }, []);
  useEffect(() => binding.current?.update(options), [options]);
  return <div ref={container} data-market-table-host="" />;
}
