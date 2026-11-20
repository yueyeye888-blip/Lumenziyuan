import { and, desc, eq } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { sampleDocumentRequests } from "@/db/schema";
import { isResourceAdmin } from "@/lib/resource-access";
import { SAMPLE_TEMPLATES } from "@/lib/sample-document";
import {
  sampleEmailConfigured,
  sendSampleDocumentEmail,
} from "@/lib/sample-document-email";

export const dynamic = "force-dynamic";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOCUMENT_TYPES = new Set<string>(SAMPLE_TEMPLATES.map((item) => item.name));

function clean(value: unknown, maxLength: number) {
  return String(value || "").trim().slice(0, maxLength);
}

function requestNumber() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `QA-${date}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

async function deliver(request: Request, row: typeof sampleDocumentRequests.$inferSelect) {
  const origin = new URL(request.url).origin;
  return sendSampleDocumentEmail({
    requestId: row.id,
    requestNo: row.requestNo,
    recipientEmail: row.recipientEmail,
    documentType: row.documentType,
    country: row.country,
    subjectName: row.subjectName,
    addressLine: row.addressLine,
    purpose: row.purpose,
    previewUrl: `${origin}/api/sample-documents/preview?id=${encodeURIComponent(row.id)}`,
  });
}

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  const db = getDb();
  const admin = isResourceAdmin(user);
  const records = await db
    .select()
    .from(sampleDocumentRequests)
    .where(admin ? undefined : eq(sampleDocumentRequests.userId, user.userId))
    .orderBy(desc(sampleDocumentRequests.createdAt))
    .limit(admin ? 300 : 100);
  return Response.json({
    viewer: {
      email: user.email,
      displayName: user.displayName,
      isAdmin: admin,
    },
    emailConfigured: sampleEmailConfigured(),
    documentTypes: Array.from(DOCUMENT_TYPES),
    records,
  }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  const body = (await request.json()) as Record<string, unknown>;
  const db = getDb();
  const admin = isResourceAdmin(user);

  if (body.action === "resend") {
    const id = clean(body.id, 80);
    const rows = await db
      .select()
      .from(sampleDocumentRequests)
      .where(
        admin
          ? eq(sampleDocumentRequests.id, id)
          : and(
              eq(sampleDocumentRequests.id, id),
              eq(sampleDocumentRequests.userId, user.userId),
            ),
      )
      .limit(1);
    const row = rows[0];
    if (!row)
      return Response.json({ error: "没有找到该测试文件" }, { status: 404 });
    if (["unknown", "accepted", "sent", "delivered"].includes(row.emailStatus)) {
      return Response.json({ error: row.emailStatus === "unknown" ? "发送结果待确认，请先核对收件箱和垃圾邮箱" : "邮件服务已接受此请求，请先核对收件箱和垃圾邮箱", emailStatus: row.emailStatus }, { status: 409 });
    }
    const delivery = await deliver(request, row);
    await db
      .update(sampleDocumentRequests)
      .set({
        emailStatus: delivery.status,
        emailError: delivery.ok ? null : delivery.error,
        emailProviderId: delivery.ok ? delivery.providerId : null,
      })
      .where(eq(sampleDocumentRequests.id, row.id));
    return Response.json({
      ok: delivery.ok,
      emailStatus: delivery.status,
      emailError: delivery.ok ? null : delivery.error,
    });
  }

  const documentType = clean(body.documentType, 40);
  const country = clean(body.country, 80);
  const subjectName = clean(body.subjectName, 120);
  const addressLine = clean(body.addressLine, 500);
  const purpose = clean(body.purpose, 240);
  const recipientEmail = clean(body.recipientEmail, 254).toLowerCase();
  if (!DOCUMENT_TYPES.has(documentType))
    return Response.json({ error: "请选择允许的测试文件类型" }, { status: 400 });
  if (!country || !subjectName || !addressLine || !purpose)
    return Response.json({ error: "请完整填写测试资料和用途" }, { status: 400 });
  if (!EMAIL_PATTERN.test(recipientEmail))
    return Response.json({ error: "请输入有效的接收邮箱" }, { status: 400 });
  if (body.acknowledged !== true)
    return Response.json(
      { error: "请确认该文件仅用于内部测试且不会提交给第三方" },
      { status: 400 },
    );

  const row: typeof sampleDocumentRequests.$inferInsert = {
    id: crypto.randomUUID(),
    requestNo: requestNumber(),
    userId: user.userId,
    userEmail: user.email.toLowerCase(),
    userName: user.displayName,
    documentType,
    country,
    subjectName,
    addressLine,
    purpose,
    recipientEmail,
    status: "generated",
    emailStatus: "pending",
  };
  await db.insert(sampleDocumentRequests).values(row);
  const saved = (await db
    .select()
    .from(sampleDocumentRequests)
    .where(eq(sampleDocumentRequests.id, row.id))
    .limit(1))[0];
  const delivery = await deliver(request, saved);
  await db
    .update(sampleDocumentRequests)
    .set({
      emailStatus: delivery.status,
      emailError: delivery.ok ? null : delivery.error,
      emailProviderId: delivery.ok ? delivery.providerId : null,
    })
    .where(eq(sampleDocumentRequests.id, row.id));

  return Response.json({
    ok: true,
    id: row.id,
    requestNo: row.requestNo,
    emailStatus: delivery.status,
    emailError: delivery.ok ? null : delivery.error,
  }, { headers: { "cache-control": "private, no-store" } });
}
