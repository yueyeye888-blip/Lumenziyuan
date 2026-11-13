import { and, eq } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { warehouseInventory } from "@/db/schema";
import { isResourceAdmin } from "@/lib/resource-access";
import { decryptSetting } from "@/lib/security-crypto";
import { sendWarehouseDelivery } from "@/lib/warehouse-email";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  const body = await request.json() as { id?: string };
  const db = getDb();
  const admin = isResourceAdmin(user);
  const rows = await db.select().from(warehouseInventory).where(
    admin ? eq(warehouseInventory.id, body.id || "") : and(eq(warehouseInventory.id, body.id || ""), eq(warehouseInventory.claimedByUserId, user.userId))
  ).limit(1);
  const row = rows[0];
  if (!row || row.status !== "claimed" || !row.recipientEmail) return Response.json({ error: "没有找到可重发的认领记录" }, { status: 404 });
  const payload = await decryptSetting(row.encryptedValue, row.iv);
  const delivery = await sendWarehouseDelivery({
    recipientEmail: row.recipientEmail,
    claimId: `retry-${row.id}`,
    items: [{ productName: row.productName, supplier: row.supplier, country: row.country, payload }],
  });
  await db.update(warehouseInventory).set({
    emailStatus: delivery.status,
    emailError: delivery.ok ? null : delivery.error,
    emailProviderId: delivery.ok ? delivery.providerId : null,
  }).where(eq(warehouseInventory.id, row.id));
  if (!delivery.ok) return Response.json({ error: delivery.error, emailStatus: delivery.status }, { status: delivery.status === "pending" ? 503 : 502 });
  return Response.json({ ok: true, emailStatus: "sent" });
}
