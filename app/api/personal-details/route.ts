import { getChatGPTUser } from "@/app/chatgpt-auth";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };

async function retiredDraftEndpoint() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401, headers });
  return Response.json({
    error: "个人资料已改为一次性填写，不再读取或保存草稿",
    code: "personal_details_drafts_retired",
  }, { status: 410, headers });
}

export const GET = retiredDraftEndpoint;
export const POST = retiredDraftEndpoint;
