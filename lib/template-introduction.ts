export type TemplateIntroduction = {
  id: number;
  summary: string;
  facts: [string, string][];
  contentItems: string[];
  note: string;
};

const fields = [
  ["机构/服务名称", "institution"], ["中文名称", "chineseName"], ["机构类型", "institutionType"],
  ["原文名称", "originalName"], ["国家 / 地区", "country"], ["可能使用地区", "possibleRegion"],
  ["文件类型", "fileType"], ["主要语言", "language"], ["货币", "currency"],
  ["展示账户/服务", "product"], ["展示内容", "content"], ["默认交付", "defaultOutput"],
] as const;

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";

export function indexIntroductions(source: unknown) {
  const result = new Map<number, TemplateIntroduction>();
  const rows = (source as {items?: unknown} | null)?.items;
  if (!Array.isArray(rows)) return result;
  for (const row of rows) {
    if (!Number.isSafeInteger(row?.publicId) || row.publicId < 1) continue;
    const facts: [string, string][] = [];
    for (const [label, field] of fields) {
      const value = text(row[field]);
      if (value) facts.push([label, value]);
    }
    result.set(row.publicId, {
      id: row.publicId, facts, summary: text(row.summary), note: text(row.note),
      contentItems: Array.isArray(row.contentItems) ? row.contentItems.map(text).filter(Boolean) : [],
    });
  }
  return result;
}
