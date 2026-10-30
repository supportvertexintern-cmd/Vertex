import { NextRequest } from "next/server";
import { appJson, appPreflight, appSession } from "@/lib/app-auth";
import { recordSecurityEvent } from "@/lib/audit";
import { callBackend } from "@/lib/backend";
import { alertOnRefusal, clientHeaders, issued, legacyError, type SignedIn } from "@/lib/auth-backend";
import { rateLimit } from "@/lib/rate-limit";
import { ACCESS_TOKEN_TTL_SECONDS } from "@/lib/session";

// Mobile app sign-in (lib/app-auth.ts): the same password check as the
// browser's /api/auth/login, made by FastAPI (users step 8.2), but the
// tokens come back in the body.
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  // The browser's bucket: signing in through the app doesn't buy more guesses.
  const rl = rateLimit(`login:${ip}`, { max: Number(process.env.LOGIN_RATE_LIMIT_MAX) || 10 });
  if (!rl.success) {
    await recordSecurityEvent("login_rate_limited", { actorId: null, entityType: "Auth", entityId: "login", detail: { client: "app" } });
    return appJson(req, { error: { code: "rate_limited", message: "Too many login attempts. Please try again later." } }, 429);
  }

  let body: { email?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return appJson(req, { error: "Invalid JSON" }, 400);
  }

  const result = await callBackend<SignedIn>("/api/v1/auth/login", {
    method: "POST",
    body: { email: body?.email, password: body?.password, client: "app" },
    asUser: false,
    forward: await clientHeaders(req),
  });
  if (!result.ok) {
    await alertOnRefusal(result);
    // FastAPI's per-account limit answers as this route's own does.
    if (result.status === 429) return appJson(req, { error: result.error }, 429);
    return appJson(req, legacyError(result.error, result.status), result.status);
  }
  const { user, session } = result.body.data;
  return appSession(req, { id: user.id, email: user.email, role: user.role, full_name: user.full_name }, issued(session), ACCESS_TOKEN_TTL_SECONDS);
}

export function OPTIONS(req: NextRequest) {
  return appPreflight(req);
}
