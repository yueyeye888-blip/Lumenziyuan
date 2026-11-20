import { and, eq } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { sampleDocumentRequests } from "@/db/schema";
import { isResourceAdmin } from "@/lib/resource-access";
import { renderSampleAttachment } from "@/lib/sample-attachment";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return new Response("请先登录", { status: 401 });
  const id = new URL(request.url).searchParams.get("id") || "";
  const row = (await getDb().select().from(sampleDocumentRequests).where(isResourceAdmin(user) ? eq(sampleDocumentRequests.id, id) : and(eq(sampleDocumentRequests.id, id), eq(sampleDocumentRequests.userId, user.userId))).limit(1))[0];
  if (!row) return new Response("没有找到该测试样张", { status: 404 });
  return new Response(renderSampleAttachment(row), { headers: {
    "content-type": "image/svg+xml; charset=utf-8", "content-disposition": `attachment; filename="${row.requestNo.replace(/[^A-Za-z0-9_-]/g, "_")}-SAMPLE.svg"`,
    "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox",
  } });
}
