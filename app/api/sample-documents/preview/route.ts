import { and, eq } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { sampleDocumentRequests } from "@/db/schema";
import { isResourceAdmin } from "@/lib/resource-access";
import { renderSampleDocument } from "@/lib/sample-document";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return new Response("请先登录", { status: 401 });
  const id = new URL(request.url).searchParams.get("id")?.trim() || "";
  const admin = isResourceAdmin(user);
  const db = getDb();
  const rows = await db.select().from(sampleDocumentRequests).where(
    admin ? eq(sampleDocumentRequests.id, id) : and(
      eq(sampleDocumentRequests.id, id),
      eq(sampleDocumentRequests.userId, user.userId),
    ),
  ).limit(1);
  const row = rows[0];
  if (!row) return new Response("没有找到该测试文件", { status: 404 });
  return new Response(renderSampleDocument(row), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex, nofollow",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
      "x-content-type-options": "nosniff",
    },
  });
}
