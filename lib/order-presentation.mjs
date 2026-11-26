export const ORDER_STEPS = ["资料提交", "资料处理", "等待处理", "等待交付确认", "邮箱交付"];
export function orderStep(status) {
  return ({ queued: 1, filling: 2, payment_pending: 3, payment_confirmed: 4, generating: 4, delivered: 5 })[status] || 1;
}
export function orderTime(value) {
  if (typeof value !== "string" || !value.trim()) return NaN;
  const normalized = value.trim().replace(" ", "T");
  return Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized) ? normalized : normalized + "Z");
}
export function orderDisplay(order, now = Date.now()) {
  if (order.status === "failed") return { title: "订单处理失败", detail: order.error || order.statusMessage || "请联系管理员处理", tone: "error" };
  if (order.status === "delivered") return { title: "已记录交付完成", detail: "已收到交付完成回执，请检查接收邮箱及垃圾邮箱。", tone: "ready" };
  const updated = orderTime(order.updatedAt);
  const lastChange = Number.isFinite(updated) ? updated : orderTime(order.createdAt);
  const elapsed = Math.max(0, now - lastChange);
  if (order.status === "filling" && order.statusMessage?.startsWith("等待人工人机验证")) {
    if (elapsed >= 300000) {
      return { title: "处理进展待核实", detail: "超过 5 分钟未收到新的处理回执，当前验证及处理结果尚未确认。请联系管理员核查订单状态。", tone: "warning" };
    }
    return { title: "等待第三方验证确认", detail: "后台报告正在等待验证结果。如果第三方页面明确提示需要人工验证，请按其正常提示操作。本站会继续查询订单状态。", tone: "warning" };
  }
  if (order.status === "queued" && elapsed >= 180000) return { title: "尚未收到处理确认", detail: "资料已接收，但超过 3 分钟未收到后续状态更新。是否已开始处理尚未确认，请管理员核查。无需再次提交资料。", tone: "warning" };
  if (["filling", "payment_pending", "payment_confirmed", "generating"].includes(order.status) && elapsed >= 600000) return { title: "处理状态长时间未更新", detail: "超过 10 分钟未收到新的处理回执，暂时无法确认进展。请管理员核查，勿重复提交或付款。", tone: "warning" };
  if (order.status === "payment_confirmed") return { title: "等待交付确认", detail: "已记录付款确认，尚未收到交付完成回执。页面会自动更新。", tone: "working" };
  if (["payment_pending", "generating", "filling"].includes(order.status)) return { title: "正在处理", detail: "尚未完成交付，页面会自动更新实际处理状态。", tone: "working" };
  return { title: "资料已提交", detail: "尚未收到后续处理结果，页面会自动更新状态。", tone: "working" };
}
