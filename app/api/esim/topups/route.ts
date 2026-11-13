import { and, eq } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { resourceOwnership } from "@/db/schema";
import { getTopUpPackages } from "@/lib/esimaccess";
import { isResourceAdmin } from "@/lib/resource-access";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return Response.json({ connected: false, error: "请先登录" }, { status: 401 });
    const url = new URL(request.url);
    const iccid = url.searchParams.get("iccid")?.trim() || "";
    const resourceId = url.searchParams.get("resourceId")?.trim() || "";
    if (!/^\d{15,24}$/.test(iccid)) {
      return Response.json({ connected: false, error: "缺少有效的 ICCID" }, { status: 400 });
    }
    if (!isResourceAdmin(user)) {
      if (!resourceId) return Response.json({ connected: false, error: "资源权限校验失败" }, { status: 403 });
      const owned = await getDb().select({ resourceId: resourceOwnership.resourceId }).from(resourceOwnership).where(and(eq(resourceOwnership.resourceId, resourceId), eq(resourceOwnership.ownerUserId, user.userId))).limit(1);
      if (!owned.length) return Response.json({ connected: false, error: "无权续订该资源" }, { status: 403 });
    }

    const result = await getTopUpPackages(iccid);
    return Response.json({
      connected: true,
      items: result.packageList.map((item) => ({
        id: item.slug || item.packageCode,
        packageCode: item.packageCode,
        name: item.name,
        description: item.description,
        price: item.price / 10_000,
        priceRaw: item.price,
        currency: item.currencyCode,
        volume: item.volume,
        duration: item.duration,
        durationUnit: item.durationUnit,
        location: item.location,
      })),
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json({ connected: false, error: error instanceof Error ? error.message : "续订套餐同步失败" }, { status: 502 });
  }
}
