/** A provider accepting a message is not a delivery receipt. */
export function mailStatus(status) {
  if (status === "delivered") return { code: "delivered", label: "已确认交付", tone: "success", detail: "已记录交付完成回执。", canRetry: false };
  if (status === "accepted" || status === "sent") return { code: "accepted", label: "邮件服务已接受", tone: "info", detail: "尚未确认收件人收到；请同时查看收件箱和垃圾邮箱。", canRetry: false };
  if (status === "failed") return { code: "failed", label: "发送失败", tone: "error", detail: "发送请求未成功，请查看具体原因。", canRetry: true };
  if (status === "unknown") return { code: "unknown", label: "发送结果待确认", tone: "warning", detail: "请先核对收件箱和垃圾邮箱，避免重复发送。", canRetry: false };
  return { code: "pending", label: "尚未发送", tone: "warning", detail: "尚未记录邮件服务接受发送的结果。", canRetry: true };
}
