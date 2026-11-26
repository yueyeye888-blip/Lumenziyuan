export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ error: "支付密码已停用。" }, { status: 410 });
}

export const POST = GET;
