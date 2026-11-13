import { getChatGPTUser } from "@/app/chatgpt-auth";
import { isResourceAdmin } from "@/lib/resource-access";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ authenticated: false }, { status: 401 });
  return Response.json({
    authenticated: true,
    viewer: {
      userId: user.userId,
      email: user.email,
      displayName: user.displayName,
      isAdmin: isResourceAdmin(user),
    },
  }, { headers: { "cache-control": "private, no-store" } });
}
