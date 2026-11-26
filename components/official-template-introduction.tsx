"use client";

import { useEffect, useState } from "react";
import type { TemplateIntroduction } from "@/lib/template-introduction";

export default function OfficialTemplateIntroduction({ id }: { id: number }) {
  const [data, setData] = useState<TemplateIntroduction | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/supplier-templates?introduction=${id}`, { signal: controller.signal });
        if (!response.ok) throw Error("官方介绍暂时无法读取");
        const value = await response.json() as TemplateIntroduction;
        if (value.id !== id) throw Error("官方介绍暂时无法读取");
        if (!controller.signal.aborted) setData(value);
      } catch {
        if (!controller.signal.aborted) setError("官方介绍暂时无法读取");
      }
    }
    void load();
    return () => controller.abort();
  }, [id, attempt]);
  return <article className="template-introduction" aria-label="官方模板介绍">
    {error ? <div role="status">{error}<button type="button" onClick={() => { setError(""); setAttempt(attempt + 1); }}>重试</button></div> :
      !data ? <p role="status">正在读取官方介绍…</p> : <>
        <h3>官方模板介绍</h3>
        <p className="intro-summary">{data.summary || "官方目录尚未提供这款模板的详细说明。"}</p>
        {data.facts.length > 0 && <><h4>资料一览</h4><dl>{data.facts.map(([label, value]) =>
          <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></>}
        {data.contentItems.length > 0 && <><h4>模板包含</h4><ul>{data.contentItems.map((line, i) => <li key={i}>{line}</li>)}</ul></>}
        {data.note && <><h4>样张备注</h4><p>{data.note}</p></>}
        <small>资料来源 · Addrs.xyz 官方模板目录</small>
      </>}
  </article>;
}
