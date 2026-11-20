import { and, desc, eq } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { sampleDocumentRequests, warehouseInventory } from "@/db/schema";
import { isResourceAdmin } from "@/lib/resource-access";
import { mailStatus } from "@/lib/mail-status.mjs";

export const dynamic = "force-dynamic";
export async function GET() {
  const user = await getChatGPTUser();
  const headers = { "cache-control": "private, no-store" };
  if (!user) return Response.json({ error: "请先登录" }, { status: 401, headers });
  const admin = isResourceAdmin(user), db = getDb();
  const [warehouse, samples] = await Promise.all([
    db.select({ id: warehouseInventory.id, name: warehouseInventory.productName, account: warehouseInventory.claimedByEmail, recipientEmail: warehouseInventory.recipientEmail, status: warehouseInventory.emailStatus, error: warehouseInventory.emailError, createdAt: warehouseInventory.claimedAt })
      .from(warehouseInventory).where(admin ? eq(warehouseInventory.status, "claimed") : and(eq(warehouseInventory.status, "claimed"), eq(warehouseInventory.claimedByUserId, user.userId)))
      .orderBy(desc(warehouseInventory.claimedAt)).limit(200),
    db.select({ id: sampleDocumentRequests.id, name: sampleDocumentRequests.requestNo, account: sampleDocumentRequests.userEmail, recipientEmail: sampleDocumentRequests.recipientEmail, status: sampleDocumentRequests.emailStatus, error: sampleDocumentRequests.emailError, createdAt: sampleDocumentRequests.createdAt })
      .from(sampleDocumentRequests).where(admin ? undefined : eq(sampleDocumentRequests.userId, user.userId))
      .orderBy(desc(sampleDocumentRequests.createdAt)).limit(200),
  ]);
  const records = [...warehouse.map(row => ({ ...row, kind: "warehouse" })), ...samples.map(row => ({ ...row, kind: "sample" }))]
    .map(row => ({ ...row, delivery: mailStatus(row.status) }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return Response.json({ viewer: { isAdmin: admin }, records }, { headers });
}
