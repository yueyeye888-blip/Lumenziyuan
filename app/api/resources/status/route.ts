import { and, eq } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { resourceOwnership, resourceStatusOverrides, warehouseInventory } from "@/db/schema";
import { isResourceAdmin } from "@/lib/resource-access";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  const body = await request.json() as {
    supplier?: string;
    resourceId?: string;
    status?: "temporary_unavailable" | "normal";
    note?: string;
    recheckHours?: number;
  };
  const supplier = body.supplier?.trim() || "";
  const resourceId = body.resourceId?.trim() || "";
  const status = body.status;
  if (!supplier || !resourceId || !["temporary_unavailable", "normal"].includes(status || "")) {
    return Response.json({ error: "资源状态参数不完整" }, { status: 400 });
  }
  const note = body.note?.trim().slice(0, 500) || null;
  if (status === "temporary_unavailable" && !note) return Response.json({ error: "请填写暂时无法使用的原因" }, { status: 400 });
  const db = getDb();
  const admin = isResourceAdmin(user);
  if (!admin) {
    if (supplier === "warehouse") {
      const owned = await db.select({ id: warehouseInventory.id }).from(warehouseInventory)
        .where(and(eq(warehouseInventory.id, resourceId), eq(warehouseInventory.claimedByUserId, user.userId))).limit(1);
      if (!owned.length) return Response.json({ error: "无权修改此资源状态" }, { status: 403 });
    } else {
      const owned = await db.select({ id: resourceOwnership.resourceId }).from(resourceOwnership)
        .where(and(eq(resourceOwnership.resourceId, resourceId), eq(resourceOwnership.ownerUserId, user.userId))).limit(1);
      if (!owned.length) return Response.json({ error: "无权修改此资源状态" }, { status: 403 });
    }
  }
  const now = new Date();
  const recheckHours = body.recheckHours === 48 ? 48 : 24;
  const recheckAt = status === "temporary_unavailable" ? new Date(now.getTime() + recheckHours * 60 * 60 * 1000).toISOString() : null;
  const id = `${supplier}:${resourceId}`;
  await db.insert(resourceStatusOverrides).values({
    id,
    supplier,
    resourceId,
    status: status || "normal",
    note,
    recheckAt,
    markedByUserId: user.userId,
    markedByEmail: user.email,
    markedAt: now.toISOString(),
    resolvedAt: status === "normal" ? now.toISOString() : null,
  }).onConflictDoUpdate({
    target: resourceStatusOverrides.id,
    set: {
      status: status || "normal",
      note,
      recheckAt,
      markedByUserId: user.userId,
      markedByEmail: user.email,
      markedAt: now.toISOString(),
      resolvedAt: status === "normal" ? now.toISOString() : null,
    },
  });
  return Response.json({ ok: true, status, recheckAt });
}
