import { NextRequest } from "next/server";
import { appJson, appPreflight, appSession, refreshTokenFromBody } from "@/lib/app-auth";
import { callBackend } from "@/lib/backend";
import { alertOnRefusal, clientHeaders, issued, refreshRefusal, type SignedIn } from "@/lib/auth-backend";
import { limitByIp } from "@/lib/rate-limit";
import { ACCESS_TOKEN_TTL_SECONDS } from "@/lib/session";

const ENDED = { error: { code: "session_ended", message: "Please sign in again." } };

// Mobile app session refresh (lib/app-auth.ts): body {refreshToken} in, a new
// access token and a new refresh token out. The same rotation as the
// browser's, made by FastAPI (users step 8.2): the presented token is spent,
// and presenting a spent one again ends the whole session (reuse detection).
// No token at all is answered here, before the rate limit (nothing to guess).
export async function POST(req: NextRequest) {
  const refreshToken = await refreshTokenFromBody(req);
  if (!refreshToken) return appJson(req, ENDED, 401);
  const limited = limitByIp(req, "auth-app-refresh", { windowMs: 60_000, max: 60 });
  if (limited) return limited;
  const result = await callBackend<SignedIn>("/api/v1/auth/refresh", {
    method: "POST",
    body: { refresh_token: refreshToken },
    asUser: false,
    forward: await clientHeaders(req),
  });
  if (!result.ok) {
    await alertOnRefusal(result);
    if (!refreshRefusal(result)) return appJson(req, { error: result.error }, result.status);
    return appJson(req, ENDED, 401);
  }
  const { user, session } = result.body.data;
  return appSession(req, { id: user.id, email: user.email, role: user.role }, issued(session), ACCESS_TOKEN_TTL_SECONDS);
}

export function OPTIONS(req: NextRequest) {
  return appPreflight(req);
}
