import { env } from "cloudflare:workers";

export type DeliveryItem = {
  productName: string;
  supplier: string;
  country?: string | null;
  payload: string;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function emailDeliveryConfigured() {
  return Boolean(env.RESEND_API_KEY && env.DELIVERY_EMAIL_FROM);
}

export async function sendWarehouseDelivery(input: {
  recipientEmail: string;
  claimId: string;
  items: DeliveryItem[];
}) {
  if (!emailDeliveryConfigured()) {
    return { ok: false as const, status: "pending" as const, error: "邮件服务尚未配置" };
  }

  const plainItems = input.items.map((item, index) =>
    `资源 ${index + 1}：${item.productName}\n供应商：${item.supplier}\n国家/地区：${item.country || "未标注"}\n交付内容：\n${item.payload}`
  ).join("\n\n--------------------\n\n");
  const htmlItems = input.items.map((item, index) => `
    <section style="margin:16px 0;padding:18px;border:1px solid #dfe6f0;border-radius:12px;background:#f8fafc">
      <div style="font-weight:700;color:#1d3b72">资源 ${index + 1} · ${escapeHtml(item.productName)}</div>
      <div style="margin-top:8px;font-size:13px;color:#667085">供应商：${escapeHtml(item.supplier)} · 国家/地区：${escapeHtml(item.country || "未标注")}</div>
      <pre style="margin-top:14px;white-space:pre-wrap;word-break:break-all;font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;color:#26364f">${escapeHtml(item.payload)}</pre>
    </section>`
  ).join("");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
      "idempotency-key": `lumen-warehouse/${input.claimId}`,
    },
    body: JSON.stringify({
      from: env.DELIVERY_EMAIL_FROM,
      to: [input.recipientEmail],
      subject: `Lumen 资源交付 · ${input.items.length} 项资源`,
      text: `你已在 Lumen 资源申购中心认领 ${input.items.length} 项资源。\n\n${plainItems}\n\n请妥善保管敏感信息，并尽快修改可修改的密码及安全设置。`,
      html: `<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#172033"><h2 style="color:#1d3b72">Lumen 资源交付</h2><p>你已认领 <strong>${input.items.length}</strong> 项资源，详情如下：</p>${htmlItems}<p style="margin-top:20px;font-size:12px;color:#8a94a6">该邮件包含敏感交付信息，请勿转发。请尽快修改可修改的密码及安全设置。</p></div>`,
    }),
  });

  const result = await response.json().catch(() => ({})) as { id?: string; message?: string; name?: string };
  if (!response.ok) {
    return { ok: false as const, status: "failed" as const, error: result.message || result.name || `邮件服务返回 ${response.status}` };
  }
  return { ok: true as const, status: "sent" as const, providerId: result.id || null };
}
