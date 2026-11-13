import { eq } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { notificationLog } from "@/db/schema";
import { getAllProfiles, type EsimProfile } from "@/lib/esimaccess";
import { isResourceAdmin } from "@/lib/resource-access";
import { getTelegramSettings } from "@/lib/telegram-settings";

export const dynamic = "force-dynamic";

function daysUntil(value?: string) {
  if (!value) return null;
  const days = Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000);
  return Number.isFinite(days) ? days : null;
}

function gb(value = 0) {
  return `${Number((value / 1024 / 1024 / 1024).toFixed(2))}GB`;
}

function masked(value?: string) {
  if (!value) return "—";
  return `••••${value.slice(-4)}`;
}

function reminderCandidates(profile: EsimProfile) {
  const packageName = profile.packageList?.[0]?.packageName || "eSIM 套餐";
  const candidates: Array<{ id: string; kind: "expiry" | "low_data"; text: string }> = [];
  const remainingDays = daysUntil(profile.expiredTime);
  if (remainingDays !== null && remainingDays >= 0 && remainingDays <= 5) {
    candidates.push({
      id: `expiry:${profile.esimTranNo}:${profile.expiredTime}`,
      kind: "expiry",
      text: `⏰ eSIM 即将到期\n套餐：${packageName}\nICCID：${masked(profile.iccid)}\n到期时间：${profile.expiredTime}\n剩余：${remainingDays} 天\n订单号：${profile.orderNo}`,
    });
  }
  if (profile.totalVolume && (profile.orderUsage || 0) / profile.totalVolume >= 0.9 && !["USED_UP", "USED_EXPIRED", "UNUSED_EXPIRED", "CANCEL"].includes(profile.esimStatus)) {
    const remaining = Math.max(0, profile.totalVolume - (profile.orderUsage || 0));
    candidates.push({
      id: `low-data:${profile.esimTranNo}:${profile.totalVolume}`,
      kind: "low_data",
      text: `⚠️ eSIM 流量余量低于 10%\n套餐：${packageName}\nICCID：${masked(profile.iccid)}\n已用：${gb(profile.orderUsage)} / ${gb(profile.totalVolume)}\n剩余：${gb(remaining)}\n订单号：${profile.orderNo}`,
    });
  }
  return candidates;
}

export async function GET() {
  const user = await getChatGPTUser();
  if (!user || !isResourceAdmin(user)) return Response.json({ error: "无权访问" }, { status: 403 });
  return Response.json({
    configured: Boolean(await getTelegramSettings()),
    schedule: "每天检查一次",
    expiryThresholdDays: 5,
    remainingDataThreshold: 0.1,
  });
}

export async function POST() {
  const user = await getChatGPTUser();
  if (!user || !isResourceAdmin(user)) {
    return Response.json({ ok: false, error: "仅资源管理员可以执行提醒检查" }, { status: 403 });
  }
  const settings = await getTelegramSettings();
  if (!settings) {
    return Response.json({ ok: false, error: "Telegram Bot Token 或 Chat ID 尚未配置" }, { status: 503 });
  }
  const { botToken, chatId } = settings;

  const history = await getAllProfiles();
  const db = getDb();
  let sent = 0;
  let skipped = 0;
  const failures: string[] = [];

  for (const profile of history.esimList) {
    for (const candidate of reminderCandidates(profile)) {
      const existing = await db.select({ id: notificationLog.id }).from(notificationLog).where(eq(notificationLog.id, candidate.id)).limit(1);
      if (existing.length) { skipped += 1; continue; }
      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: candidate.text }),
      });
      if (!response.ok) {
        failures.push(`${profile.esimTranNo}:${response.status}`);
        continue;
      }
      await db.insert(notificationLog).values({ id: candidate.id, resourceId: profile.esimTranNo, kind: candidate.kind });
      sent += 1;
    }
  }

  return Response.json({ ok: failures.length === 0, checked: history.pager.total, sent, skipped, failures });
}
