export const MAIL_KIND_OPTIONS = [
  ["address_order", "地址生成器"],
  ["esim_workbook", "eSIM 流量卡"],
  ["warehouse", "库存资源"],
  ["sample", "SAMPLE 测试文件"],
  ["other", "其他资源"],
];

const mailKindLabels = new Map(MAIL_KIND_OPTIONS);
const mailTimeFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Singapore",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

export function mailKind(kind) {
  return mailKindLabels.has(kind) ? kind : "other";
}

export function mailKindLabel(kind) {
  return mailKindLabels.get(mailKind(kind));
}

export function formatMailTime(value) {
  if (typeof value !== "string" || !value.trim()) return "未记录";
  const input = value.trim().replace(" ", "T").replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const time = Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/i.test(input) ? input : input + "Z");
  return Number.isFinite(time) ? `${mailTimeFormatter.format(time)} (UTC+8)` : "未记录";
}

export function mailRecordTimes(row) {
  const label = row.kind === "warehouse" ? "认领时间：" : row.kind === "esim_workbook" ? "发送请求时间：" :
    ["sample", "address_order"].includes(row.kind) ? "提交时间：" : "创建时间：";
  const times = [[label, formatMailTime(row.createdAt)]];
  if (row.kind === "address_order") {
    times.push(["状态更新时间：", formatMailTime(row.updatedAt)]);
  } else if (row.updatedAt || row.delivery.code !== "pending") {
    times.push(["发送结果记录时间：", formatMailTime(row.updatedAt)]);
  }
  return times;
}

export function filterMailRecords(records, kind, status, query) {
  const needle = query.trim().toLowerCase();
  return records.filter(row => (kind === "all" || kind === mailKind(row.kind)) &&
    (status === "all" || status === row.delivery.code) &&
    `${row.name} ${row.id} ${row.recipientEmail || ""} ${row.account || ""}`.toLowerCase().includes(needle));
}
