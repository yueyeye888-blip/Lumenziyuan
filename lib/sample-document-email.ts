import { env } from "cloudflare:workers";

export type SampleDocumentEmailInput = {
  requestId: string;
  requestNo: string;
  recipientEmail: string;
  documentType: string;
  country: string;
  subjectName: string;
  addressLine: string;
  purpose: string;
  previewUrl: string;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function sampleEmailConfigured() {
  return Boolean(env.RESEND_API_KEY && env.DELIVERY_EMAIL_FROM);
}

export async function sendSampleDocumentEmail(input: SampleDocumentEmailInput) {
  if (!sampleEmailConfigured()) {
    return {
      ok: false as const,
      status: "pending" as const,
      error: "邮件服务尚未配置，测试文件已保存在站内",
    };
  }

  const notice =
    "该内容仅用于公司内部培训、界面测试或流程验收，不具备法律效力，不得提交给任何第三方作为身份证明、地址证明、财务证明或 KYC 材料。";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
      "idempotency-key": `lumen-sample/${input.requestId}`,
    },
    body: JSON.stringify({
      from: env.DELIVERY_EMAIL_FROM,
      to: [input.recipientEmail],
      subject: `[SAMPLE / NOT VALID] Lumen 测试文件 · ${input.requestNo}`,
      text: `Lumen 内部测试文件\nSAMPLE / NOT VALID / 仅供测试\n\n申请编号：${input.requestNo}\n测试类型：${input.documentType}\n国家/地区：${input.country}\n测试姓名：${input.subjectName}\n测试地址：${input.addressLine}\n用途：${input.purpose}\n\n在线查看与打印：${input.previewUrl}\n\n${notice}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#172033">
        <div style="padding:22px;border-radius:18px;background:#172a52;color:#fff">
          <div style="font-size:12px;letter-spacing:.18em;color:#b9c9ec">LUMEN INTERNAL QA</div>
          <h2 style="margin:10px 0 0">测试文件生成结果</h2>
        </div>
        <div style="margin:18px 0;padding:18px;border:2px solid #d65353;border-radius:14px;background:#fff5f5;text-align:center;color:#a12c2c">
          <strong style="font-size:22px">SAMPLE / NOT VALID / 仅供测试</strong>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr><td style="padding:10px;border-bottom:1px solid #e8edf5;color:#667085">申请编号</td><td style="padding:10px;border-bottom:1px solid #e8edf5">${escapeHtml(input.requestNo)}</td></tr>
          <tr><td style="padding:10px;border-bottom:1px solid #e8edf5;color:#667085">测试类型</td><td style="padding:10px;border-bottom:1px solid #e8edf5">${escapeHtml(input.documentType)}</td></tr>
          <tr><td style="padding:10px;border-bottom:1px solid #e8edf5;color:#667085">国家/地区</td><td style="padding:10px;border-bottom:1px solid #e8edf5">${escapeHtml(input.country)}</td></tr>
          <tr><td style="padding:10px;border-bottom:1px solid #e8edf5;color:#667085">测试姓名</td><td style="padding:10px;border-bottom:1px solid #e8edf5">${escapeHtml(input.subjectName)}</td></tr>
          <tr><td style="padding:10px;border-bottom:1px solid #e8edf5;color:#667085">测试地址</td><td style="padding:10px;border-bottom:1px solid #e8edf5">${escapeHtml(input.addressLine)}</td></tr>
          <tr><td style="padding:10px;border-bottom:1px solid #e8edf5;color:#667085">测试用途</td><td style="padding:10px;border-bottom:1px solid #e8edf5">${escapeHtml(input.purpose)}</td></tr>
        </table>
        <p style="margin:22px 0"><a href="${escapeHtml(input.previewUrl)}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#1d3b72;color:#fff;text-decoration:none">查看并打印测试文件</a></p>
        <p style="padding:14px;border-radius:12px;background:#f7f9fc;font-size:12px;line-height:1.7;color:#667085">${notice}</p>
      </div>`,
    }),
  });

  const result = (await response.json().catch(() => ({}))) as {
    id?: string;
    message?: string;
    name?: string;
  };
  if (!response.ok) {
    return {
      ok: false as const,
      status: "failed" as const,
      error:
        result.message || result.name || `邮件服务返回 ${response.status}`,
    };
  }
  return {
    ok: true as const,
    status: "sent" as const,
    providerId: result.id || null,
  };
}
