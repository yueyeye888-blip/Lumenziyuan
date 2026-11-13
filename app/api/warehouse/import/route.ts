import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { warehouseInventory } from "@/db/schema";
import { isResourceAdmin } from "@/lib/resource-access";
import { encryptSetting } from "@/lib/security-crypto";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user || !isResourceAdmin(user)) return Response.json({ error: "仅管理员可以向仓库入库" }, { status: 403 });
  const body = await request.json() as {
    supplier?: string; productName?: string; category?: string; country?: string;
    unitPrice?: number | null; currency?: string; items?: string[];
  };
  const supplier = body.supplier?.trim();
  const productName = body.productName?.trim();
  const items = (body.items || []).map((item) => item.trim()).filter(Boolean);
  if (!supplier || !productName) return Response.json({ error: "供应商和商品名称不能为空" }, { status: 400 });
  if (!items.length || items.length > 500) return Response.json({ error: "每次请入库 1–500 项资源" }, { status: 400 });
  const batchId = crypto.randomUUID();
  const rows = await Promise.all(items.map(async (payload) => ({
    id: crypto.randomUUID(),
    batchId,
    supplier,
    productName,
    category: body.category?.trim() || "数字账号",
    country: body.country?.trim() || null,
    unitPrice: typeof body.unitPrice === "number" && body.unitPrice >= 0 ? Math.round(body.unitPrice * 100) : null,
    currency: body.currency?.trim().toUpperCase() || "USD",
    ...(await encryptSetting(payload)),
    status: "available",
    emailStatus: "not_sent",
    createdBy: user.userId,
  })));
  const db = getDb();
  for (let index = 0; index < rows.length; index += 25) {
    await db.insert(warehouseInventory).values(rows.slice(index, index + 25));
  }
  return Response.json({ ok: true, batchId, imported: rows.length });
}
