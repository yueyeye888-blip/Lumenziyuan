import { and, desc, eq, inArray } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { resourceStatusOverrides, warehouseInventory } from "@/db/schema";
import { isResourceAdmin } from "@/lib/resource-access";
import { decryptSetting } from "@/lib/security-crypto";
import { emailDeliveryConfigured } from "@/lib/warehouse-email";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  const admin = isResourceAdmin(user);
  const db = getDb();
  const availableRows = await db.select({
    id: warehouseInventory.id,
    batchId: warehouseInventory.batchId,
    supplier: warehouseInventory.supplier,
    productName: warehouseInventory.productName,
    category: warehouseInventory.category,
    country: warehouseInventory.country,
    unitPrice: warehouseInventory.unitPrice,
    currency: warehouseInventory.currency,
    createdAt: warehouseInventory.createdAt,
  }).from(warehouseInventory).where(eq(warehouseInventory.status, "available")).orderBy(desc(warehouseInventory.createdAt));

  const batches = new Map<string, typeof availableRows[number] & { available: number }>();
  for (const row of availableRows) {
    const existing = batches.get(row.batchId);
    if (existing) existing.available += 1;
    else batches.set(row.batchId, { ...row, available: 1 });
  }

  const claimedRows = await db.select().from(warehouseInventory)
    .where(admin ? eq(warehouseInventory.status, "claimed") : and(eq(warehouseInventory.status, "claimed"), eq(warehouseInventory.claimedByUserId, user.userId)))
    .orderBy(desc(warehouseInventory.claimedAt));

  const claimedIds = claimedRows.map((row) => row.id);
  const overrideRows = claimedIds.length ? await db.select().from(resourceStatusOverrides).where(and(
    eq(resourceStatusOverrides.supplier, "warehouse"),
    inArray(resourceStatusOverrides.resourceId, claimedIds),
  )) : [];
  const overrides = new Map(overrideRows.map((row) => [row.resourceId, row]));

  const claims = await Promise.all(claimedRows.slice(0, admin ? 500 : 200).map(async (row) => ({
    id: row.id,
    batchId: row.batchId,
    supplier: row.supplier,
    productName: row.productName,
    category: row.category,
    country: row.country,
    unitPrice: row.unitPrice,
    currency: row.currency,
    payload: await decryptSetting(row.encryptedValue, row.iv),
    claimedByName: row.claimedByName,
    claimedByEmail: row.claimedByEmail,
    recipientEmail: row.recipientEmail,
    claimedAt: row.claimedAt,
    emailStatus: row.emailStatus,
    emailError: row.emailError,
    availabilityStatus: overrides.get(row.id)?.status || "normal",
    availabilityNote: overrides.get(row.id)?.note || null,
    availabilityRecheckAt: overrides.get(row.id)?.recheckAt || null,
  })));

  return Response.json({
    viewer: { email: user.email, displayName: user.displayName, isAdmin: admin },
    emailConfigured: emailDeliveryConfigured(),
    stats: { available: availableRows.length, claimed: claimedRows.length, batches: batches.size },
    batches: Array.from(batches.values()),
    claims,
  }, { headers: { "cache-control": "private, no-store" } });
}
