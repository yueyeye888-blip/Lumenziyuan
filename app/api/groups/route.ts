import { asc, eq, inArray } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import {
  resourceGroupItems,
  resourceGroupMembers,
  resourceGroups,
} from "@/db/schema";
import { isResourceAdmin } from "@/lib/resource-access";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  const db = getDb();
  const admin = isResourceAdmin(user);
  const [groups, items] = await Promise.all([
    db.select().from(resourceGroups).orderBy(asc(resourceGroups.createdAt)),
    db
      .select()
      .from(resourceGroupItems)
      .orderBy(asc(resourceGroupItems.createdAt)),
  ]);
  return Response.json(
    {
      groups: groups.map((group) => ({
        ...group,
        canPurchase: true,
        products: items
          .filter((item) => item.groupId === group.id)
          .map((item) => ({
            id: item.productId,
            name: item.productName,
            packageCode: item.packageCode,
            country: item.country,
            supplier: item.supplier,
          })),
      })),
      canManage: admin,
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user || !isResourceAdmin(user))
    return Response.json(
      { error: "仅管理员可以管理业务分组" },
      { status: 403 },
    );
  const body = (await request.json()) as {
    id?: string;
    name?: string;
    accent?: string;
    products?: Array<{
      id?: string;
      name?: string;
      packageCode?: string | null;
      country?: string | null;
      supplier?: string;
    }>;
  };
  const name = body.name?.trim().slice(0, 40) || "";
  const products = (body.products || [])
    .filter((item) => item.id && item.name)
    .slice(0, 500);
  if (!name) return Response.json({ error: "请填写分组名称" }, { status: 400 });
  const id = body.id?.trim() || crypto.randomUUID();
  const now = new Date().toISOString();
  const db = getDb();
  await db
    .insert(resourceGroups)
    .values({
      id,
      name,
      accent: body.accent || "bg-[#5578b6]",
      createdBy: user.userId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: resourceGroups.id,
      set: { name, accent: body.accent || "bg-[#5578b6]", updatedAt: now },
    });
  await db.delete(resourceGroupItems).where(eq(resourceGroupItems.groupId, id));
  if (products.length) {
    for (let index = 0; index < products.length; index += 25) {
      await db.insert(resourceGroupItems).values(
        products.slice(index, index + 25).map((item) => ({
          id: `${id}:${item.id}`,
          groupId: id,
          productId: item.id!,
          productName: item.name!,
          packageCode: item.packageCode || null,
          country: item.country || null,
          supplier: item.supplier || "eSIMAccess",
        })),
      );
    }
  }
  return Response.json({
    ok: true,
    id,
    productCount: products.length,
  });
}

export async function DELETE(request: Request) {
  const user = await getChatGPTUser();
  if (!user || !isResourceAdmin(user))
    return Response.json(
      { error: "仅管理员可以删除业务分组" },
      { status: 403 },
    );
  const ids =
    ((await request.json()) as { ids?: string[] }).ids
      ?.filter(Boolean)
      .slice(0, 50) || [];
  if (!ids.length)
    return Response.json({ error: "请选择要删除的分组" }, { status: 400 });
  const db = getDb();
  await db
    .delete(resourceGroupMembers)
    .where(inArray(resourceGroupMembers.groupId, ids));
  await db
    .delete(resourceGroupItems)
    .where(inArray(resourceGroupItems.groupId, ids));
  await db.delete(resourceGroups).where(inArray(resourceGroups.id, ids));
  return Response.json({ ok: true });
}
