import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { ADDRESS_TRANSLATION_INSTRUCTIONS, SOURCE_ADDRESS_LIMIT, validateAddressTranslation } from "@/lib/personal-details";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };
const cooldowns = new Map<string, number>();

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401, headers });
  return Response.json({ configured: Boolean(env.OPENAI_API_KEY), provider: "OpenAI" }, { headers });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401, headers });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "请求来源不匹配" }, { status: 403, headers });
  let source: string;
  try {
    const body = await request.json() as { address?: unknown };
    if (typeof body.address !== "string") throw new Error();
    source = body.address.trim();
    if (source.length < 3 || source.length > SOURCE_ADDRESS_LIMIT || !/[\p{L}\p{N}]/u.test(source)) throw new Error();
  } catch { return Response.json({ error: "请输入 3–2000 字的真实地址原文" }, { status: 400, headers }); }
  if (!env.OPENAI_API_KEY) return Response.json({ error: "AI 地址翻译尚未启用，请管理员完成 OpenAI 服务配置；仍可手动填写三行英文地址", code: "translation_not_configured" }, { status: 503, headers });
  const now = Date.now();
  for (const [id, expiry] of cooldowns) if (expiry <= now) cooldowns.delete(id);
  if ((cooldowns.get(user.userId) || 0) > now) return Response.json({ error: "翻译请求较频繁，请稍后重试" }, { status: 429, headers: { ...headers, "retry-after": "15" } });
  cooldowns.set(user.userId, now + 15000);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({
        model: env.ADDRESS_TRANSLATION_MODEL || "gpt-4.1-mini",
        store: false,
        instructions: ADDRESS_TRANSLATION_INSTRUCTIONS,
        input: JSON.stringify({ address: source }),
        max_output_tokens: 2600,
        text: { format: {
          type: "json_schema", name: "existing_address_translation", strict: true,
          schema: { type: "object", additionalProperties: false,
            properties: {
              segments: { type: "array", items: { type: "object", additionalProperties: false,
                properties: { source: { type: "string" }, translation: { type: "string" }, line: { type: "integer", enum: [0, 1, 2] } }, required: ["source", "translation", "line"] } },
              notes: { type: "array", items: { type: "string" } },
            }, required: ["segments", "notes"],
          },
        } },
      }),
    });
    if (!response.ok) return Response.json({ error: response.status === 429 ? "AI 服务额度或请求频率受限，请管理员检查后重试" : "AI 翻译服务暂时不可用，请稍后重试" }, { status: 502, headers });
    const data = await response.json() as { status?: string; output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }> };
    if (data.status !== "completed") return Response.json({ error: "翻译结果未完成，已保留原地址，请重试" }, { status: 502, headers });
    const output = (data.output || []).flatMap((item) => item.type === "message" ? item.content || [] : []).filter((item) => item.type === "output_text").map((item) => item.text || "").join("");
    if (!output) return Response.json({ error: "未获得可用的地址翻译，已保留原地址" }, { status: 422, headers });
    let translation;
    try { translation = validateAddressTranslation(source, JSON.parse(output)); }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : "翻译结果校验失败，原地址未改动" }, { status: 422, headers }); }
    return Response.json(translation, { headers });
  } catch { return Response.json({ error: "地址翻译超时或暂不可用，原地址未改动，请稍后重试" }, { status: 502, headers }); }
}
