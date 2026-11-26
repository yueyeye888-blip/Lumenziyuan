import type { SampleDocumentData } from "@/lib/sample-document";
import type { MailAttachment } from "@/lib/mail-delivery";

const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
export function renderSampleAttachment(input: SampleDocumentData) {
  const lines = ["SAMPLE / NOT VALID", "Yorke AI 内部测试样张", input.documentType, `编号：${input.requestNo || "SAMPLE"}`, `国家/地区：${input.country}`, `测试姓名：${input.subjectName}`, `测试地址：${input.addressLine}`, `用途：${input.purpose}`, "仅供内部测试，不具备法律效力"];
  const wrapped = lines.flatMap(line => Array.from(line).reduce<string[]>((rows, c, i) => {
    if (i % 45 === 0) rows.push(""); rows[rows.length - 1] += c; return rows;
  }, []));
  const height = Math.max(640, 120 + wrapped.length * 42);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="${height}" viewBox="0 0 1100 ${height}"><rect width="1100" height="${height}" fill="#fff"/><rect x="20" y="20" width="1060" height="${height - 40}" fill="none" stroke="#b42318" stroke-width="4"/>${wrapped.map((line, i) => `<text x="60" y="${80 + i * 42}" font-family="Arial, sans-serif" font-size="${i === 0 ? 30 : 22}" fill="${i === 0 ? "#b42318" : "#243d64"}">${escape(line)}</text>`).join("")}</svg>`;
}
export function sampleAttachment(input: SampleDocumentData): MailAttachment {
  const svg = renderSampleAttachment(input);
  const bytes = new TextEncoder().encode(svg);
  return { name: `${(input.requestNo || "SAMPLE").replace(/[^A-Za-z0-9_-]/g, "_")}-SAMPLE.svg`, contentType: "image/svg+xml", contentBase64: btoa(String.fromCharCode(...bytes)) };
}
