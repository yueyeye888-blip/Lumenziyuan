import { env } from "cloudflare:workers";

export type MailResult =
  | { ok: true; status: "accepted"; providerId: string | null }
  | { ok: false; status: "pending" | "failed" | "unknown"; error: string };
export type MailAttachment = { name: string; contentType: "image/svg+xml"; contentBase64: string };

export function mailConfigured() {
  return Boolean(env.MAIL_DELIVERY || (env.RESEND_API_KEY && env.DELIVERY_EMAIL_FROM));
}

export async function submitMail(key: string, mail: {
  to: string; subject: string; text: string; html: string; attachments?: MailAttachment[];
}): Promise<MailResult> {
  if (!mailConfigured()) return { ok: false, status: "pending", error: "邮件服务尚未配置；内容仍可在站内查看" };
  try {
    const response = env.MAIL_DELIVERY
      ? await env.MAIL_DELIVERY.fetch("https://mail.internal/send", {
          method: "POST", headers: { "content-type": "application/json", "idempotency-key": key },
          body: JSON.stringify(mail),
        })
      : await fetch("https://api.resend.com/emails", {
          method: "POST", headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json", "idempotency-key": key },
          body: JSON.stringify({ from: env.DELIVERY_EMAIL_FROM, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html,
            ...(mail.attachments?.length ? { attachments: mail.attachments.map(a => ({ filename: a.name, content: a.contentBase64, content_type: a.contentType })) } : {}),
          }),
        });
    const result = await response.json().catch(() => null) as { ok?: boolean; id?: string; providerId?: string; status?: string; error?: string; message?: string } | null;
    if (response.ok && result && (env.MAIL_DELIVERY ? result.ok === true : Boolean(result.id))) {
      return { ok: true, status: "accepted", providerId: result.providerId || result.id || null };
    }
    if (response.ok || result?.status === "unknown" || (!result && response.status >= 500) || response.status === 408 || response.status === 504) {
      return { ok: false, status: "unknown", error: "发送结果待确认，请核对收件箱和垃圾邮箱；系统不会自动重复发送" };
    }
    return { ok: false, status: "failed", error: result?.error || result?.message || `邮件服务未接受发送请求（${response.status}）` };
  } catch {
    return { ok: false, status: "unknown", error: "邮件服务连接中断，发送结果待确认；请核对收件箱和垃圾邮箱" };
  }
}
