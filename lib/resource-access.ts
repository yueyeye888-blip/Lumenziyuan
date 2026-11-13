import { env } from "cloudflare:workers";
import type { ChatGPTUser } from "@/app/chatgpt-auth";

export function isResourceAdmin(user: ChatGPTUser) {
  const admins = String(env.RESOURCE_ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  // Local dev only: identity issued by /signin-with-chatgpt?as=admin
  if (process.env.NODE_ENV === "development") admins.push("admin@sites.test");
  return admins.includes(user.email.toLowerCase());
}
