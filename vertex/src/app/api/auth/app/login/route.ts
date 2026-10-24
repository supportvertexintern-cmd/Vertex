import { NextRequest } from "next/server";
import { appJson, appPreflight, appResponse, appSession } from "@/lib/app-auth";
import { recordSecurityEvent } from "@/lib/audit";
import { verifyPasswordLogin } from "@/lib/password-login";
import { rateLimit } from "@/lib/rate-limit";
import { ACCESS_TOKEN_TTL_SECONDS, startSession } from "@/lib/session";

// Mobile app sign-in (lib/app-auth.ts): the same password check as the
// browser's /api/auth/login, but the tokens come back in the body.
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  // The browser's bucket: signing in through the app doesn't buy more guesses.
  const rl = rateLimit(`login:${ip}`, { max: Number(process.env.LOGIN_RATE_LIMIT_MAX) || 10 });
  if (!rl.success) {
    await recordSecurityEvent("login_rate_limited", { actorId: null, entityType: "Auth", entityId: "login", detail: { client: "app" } });
    return appJson(req, { error: { code: "rate_limited", message: "Too many login attempts. Please try again later." } }, 429);
  }

  const login = await verifyPasswordLogin(req, "app");
  if (!login.ok) return appResponse(req, login.response);
  const { user } = login;

  const session = await startSession(user, req);
  return appSession(req, { id: user.id, email: user.email, role: user.role, full_name: user.full_name }, session, ACCESS_TOKEN_TTL_SECONDS);
}

export function OPTIONS(req: NextRequest) {
  return appPreflight(req);
}
