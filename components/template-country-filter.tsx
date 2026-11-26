"use client";

import { useState } from "react";

type Props = {
  countries: string[];
  value: string;
  onChange: (value: string) => void;
};

export default function TemplateCountryFilter({ countries, value, onChange }: Props) {
  const [expanded, setExpanded] = useState(false);
  if (!countries.length) return null;

  return <div className="catalog-country-filter" data-expanded={expanded}>
    <div className="catalog-country-heading">
      <span>国家 / 地区</span>
      {countries.length >= 8 && <button type="button" className="catalog-country-toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        {expanded ? "收起" : "展开全部"}
      </button>}
    </div>
    <div className="catalog-country-list" role="group" aria-label="按国家或地区筛选模板">
      {["", ...countries].map(country => <button key={country} type="button" aria-pressed={value === country} onClick={() => onChange(country)}>
        {country || "全部"}
      </button>)}
    </div>
  </div>;
}
