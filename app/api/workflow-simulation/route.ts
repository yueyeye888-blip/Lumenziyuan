import { getChatGPTUser } from "@/app/chatgpt-auth";
import { isResourceAdmin } from "@/lib/resource-access";
import { validatePersonalDetails } from "@/lib/personal-details";
import { createWorkflowSimulation } from "@/lib/workflow-simulation.mjs";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401, headers });
  if (!isResourceAdmin(user)) return Response.json({ error: "仅管理员可运行隔离测试" }, { status: 403, headers });
  return Response.json({ enabled: true, testOnly: true }, { headers });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401, headers });
  if (!isResourceAdmin(user)) return Response.json({ error: "仅管理员可运行隔离测试" }, { status: 403, headers });

  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: "请求来源不匹配" }, { status: 403, headers });
  }

  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > 8192) {
      return Response.json({ error: "测试资料不能超过 8 KB" }, { status: 413, headers });
    }
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return Response.json({ error: "测试请求格式无效" }, { status: 400, headers });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ error: "测试请求必须是有效的 JSON" }, { status: 400, headers });
  }

  if (body.acknowledged !== true) {
    return Response.json({ error: "请确认使用虚构测试资料" }, { status: 400, headers });
  }

  let profile;
  try {
    profile = validatePersonalDetails(body.profile);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "测试资料无效" }, { status: 400, headers });
  }

  let result;
  try {
    result = createWorkflowSimulation(
      profile,
      body.scenario,
      `MOCK-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    );
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "测试场景无效" }, { status: 400, headers });
  }

  await new Promise((resolve) => setTimeout(resolve, body.scenario === "timeout" ? 1200 : 500));
  return Response.json(result, { headers });
}
