import { desc, eq } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { quotaTransactions } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  const rows = await getDb().select().from(quotaTransactions).where(eq(quotaTransactions.userId, user.userId)).orderBy(desc(quotaTransactions.createdAt)).limit(200);
  return Response.json({ items: rows.map((row) => ({ ...row, amount: row.amount / 10_000, balanceAfter: row.balanceAfter / 10_000, currency: "USD" })) });
}
