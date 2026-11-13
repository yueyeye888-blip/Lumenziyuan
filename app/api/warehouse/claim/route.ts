import { env } from "cloudflare:workers";
import { and, asc, eq } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { warehouseInventory } from "@/db/schema";
import { decryptSetting } from "@/lib/security-crypto";
import { sendWarehouseDelivery } from "@/lib/warehouse-email";

export const dynamic = "force-dynamic";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  const body = await request.json() as { batchId?: string; quantity?: number; recipientEmail?: string };
  const batchId = body.batchId?.trim();
  const quantity = Math.floor(Number(body.quantity || 0));
  const recipientEmail = body.recipientEmail?.trim().toLowerCase() || "";
  if (!batchId || quantity < 1 || quantity > 100) return Response.json({ error: "认领数量必须为 1–100" }, { status: 400 });
  if (!EMAIL_PATTERN.test(recipientEmail)) return Response.json({ error: "请输入有效的接收邮箱" }, { status: 400 });

  const db = getDb();
  const binding = env.DB;
  if (!binding) return Response.json({ error: "数据库尚未连接" }, { status: 503 });
  const candidates = await db.select().from(warehouseInventory)
    .where(and(eq(warehouseInventory.batchId, batchId), eq(warehouseInventory.status, "available")))
    .orderBy(asc(warehouseInventory.createdAt))
    .limit(quantity);
  if (candidates.length < quantity) return Response.json({ error: `当前库存仅剩 ${candidates.length} 项，请调整认领数量` }, { status: 409 });

  const claimedAt = new Date().toISOString();
  const statements = candidates.map((row) => binding.prepare(
    "UPDATE warehouse_inventory SET status = 'claimed', claimed_by_user_id = ?, claimed_by_email = ?, claimed_by_name = ?, recipient_email = ?, claimed_at = ?, email_status = 'pending', email_error = NULL WHERE id = ? AND status = 'available' RETURNING id"
  ).bind(user.userId, user.email, user.displayName, recipientEmail, claimedAt, row.id));
  const results = await binding.batch<{ id: string }>(statements);
  const claimedIds = new Set(results.flatMap((result) => result.results || []).map((row) => row.id));
  const claimedRows = candidates.filter((row) => claimedIds.has(row.id));
  if (claimedRows.length !== quantity) return Response.json({ error: "部分库存刚被其他人认领，请刷新后重试" }, { status: 409 });

  const deliveryItems = await Promise.all(claimedRows.map(async (row) => ({
    productName: row.productName,
    supplier: row.supplier,
    country: row.country,
    payload: await decryptSetting(row.encryptedValue, row.iv),
  })));
  const claimId = `${batchId}-${claimedAt}`;
  const delivery = await sendWarehouseDelivery({ recipientEmail, claimId, items: deliveryItems });
  const emailStatus = delivery.status;
  const emailError = delivery.ok ? null : delivery.error;
  const emailProviderId = delivery.ok ? delivery.providerId : null;
  await binding.batch(claimedRows.map((row) => binding.prepare(
    "UPDATE warehouse_inventory SET email_status = ?, email_error = ?, email_provider_id = ? WHERE id = ?"
  ).bind(emailStatus, emailError, emailProviderId, row.id)));

  return Response.json({
    ok: true,
    claimed: claimedRows.length,
    recipientEmail,
    emailStatus,
    emailError,
    items: claimedRows.map((row, index) => ({ id: row.id, productName: row.productName, payload: deliveryItems[index].payload })),
  });
}
