import { and, eq, inArray } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { resourceOwnership, resourceStatusOverrides } from "@/db/schema";
import { getAllProfiles, getBalance } from "@/lib/esimaccess";
import { isResourceAdmin } from "@/lib/resource-access";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ connected: false, error: "请先登录" }, { status: 401 });
  const admin = isResourceAdmin(user);
  const viewer = { userId: user.userId, email: user.email, displayName: user.displayName, isAdmin: admin };
  try {
    const [balance, fullHistory, ownedRows] = await Promise.all([
      admin ? getBalance() : Promise.resolve(null),
      getAllProfiles(),
      admin ? Promise.resolve([]) : getDb().select({ resourceId: resourceOwnership.resourceId }).from(resourceOwnership).where(eq(resourceOwnership.ownerUserId, user.userId)),
    ]);
    const ownedIds = new Set(ownedRows.map((row) => row.resourceId));
    const visibleProfiles = admin ? fullHistory.esimList : fullHistory.esimList.filter((profile) => ownedIds.has(profile.esimTranNo));
    const visibleIds = visibleProfiles.map((profile) => profile.esimTranNo).filter(Boolean);
    const overrideRows = visibleIds.length ? await getDb().select().from(resourceStatusOverrides).where(and(
      eq(resourceStatusOverrides.supplier, "eSIMAccess"),
      inArray(resourceStatusOverrides.resourceId, visibleIds),
    )) : [];
    const overrides = new Map(overrideRows.map((row) => [row.resourceId, row]));
    return Response.json({
      connected: true,
      platform: "eSIMAccess",
      viewer,
      balance: balance ? { raw: balance.balance, amount: balance.balance / 10_000, currency: "USD" } : undefined,
      history: {
        total: visibleProfiles.length,
        supplierTotal: fullHistory.pager.total,
        items: visibleProfiles.map((profile) => ({
          availabilityStatus: overrides.get(profile.esimTranNo)?.status || "normal",
          availabilityNote: overrides.get(profile.esimTranNo)?.note || null,
          availabilityRecheckAt: overrides.get(profile.esimTranNo)?.recheckAt || null,
          orderNo: profile.orderNo,
          transactionId: profile.transactionId || null,
          esimTranNo: profile.esimTranNo,
          iccid: profile.iccid || null,
          imsi: profile.imsi || null,
          msisdn: profile.msisdn || null,
          activationCode: profile.ac || null,
          qrCodeUrl: profile.qrCodeUrl || null,
          shortUrl: profile.shortUrl || null,
          eid: profile.eid || null,
          smsStatus: profile.smsStatus ?? null,
          activeType: profile.activeType ?? null,
          dataType: profile.dataType ?? null,
          activateTime: profile.activateTime || null,
          esimStatus: profile.esimStatus,
          smdpStatus: profile.smdpStatus,
          totalVolume: profile.totalVolume || 0,
          orderUsage: profile.orderUsage || 0,
          expiredTime: profile.expiredTime || null,
          totalDuration: profile.totalDuration || profile.packageList?.[0]?.duration || null,
          durationUnit: profile.durationUnit || "DAY",
          pin: profile.pin || null,
          puk: profile.puk || null,
          apn: profile.apn || null,
          packageName: profile.packageList?.[0]?.packageName || "eSIM 套餐",
          packageCode: profile.packageList?.[0]?.packageCode || null,
          locationCode: profile.packageList?.[0]?.locationCode || null,
          createTime: profile.packageList?.[0]?.createTime || null,
        })),
      },
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json({ connected: false, viewer, error: error instanceof Error ? error.message : "同步失败" }, { status: 502 });
  }
}
