import { eq } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { userSecurity } from "@/db/schema";
import { hashPin, verifyPin } from "@/lib/security-crypto";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  const rows = await getDb().select({ updatedAt: userSecurity.updatedAt }).from(userSecurity).where(eq(userSecurity.userId, user.userId)).limit(1);
  return Response.json({ configured: Boolean(rows.length), updatedAt: rows[0]?.updatedAt || null });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  const body = await request.json() as { currentPin?: string; newPin?: string };
  if (!/^\d{6}$/.test(body.newPin || "")) return Response.json({ error: "支付密码必须是6位数字" }, { status: 400 });
  const existing = await getDb().select().from(userSecurity).where(eq(userSecurity.userId, user.userId)).limit(1);
  if (existing.length) {
    if (!/^\d{6}$/.test(body.currentPin || "") || !(await verifyPin(body.currentPin || "", existing[0].pinHash, existing[0].pinSalt))) {
      return Response.json({ error: "当前支付密码不正确" }, { status: 400 });
    }
  }
  const next = await hashPin(body.newPin || "");
  await getDb().insert(userSecurity).values({ userId: user.userId, pinHash: next.hash, pinSalt: next.salt }).onConflictDoUpdate({ target: userSecurity.userId, set: { pinHash: next.hash, pinSalt: next.salt, failedAttempts: 0, lockedUntil: null, updatedAt: new Date().toISOString() } });
  return Response.json({ configured: true, updatedAt: new Date().toISOString() });
}
