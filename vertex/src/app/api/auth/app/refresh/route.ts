import { NextRequest } from "next/server";
import { appJson, appPreflight, appSession, refreshTokenFromBody } from "@/lib/app-auth";
import { limitByIp } from "@/lib/rate-limit";
import { ACCESS_TOKEN_TTL_SECONDS, refreshSession } from "@/lib/session";

// Mobile app session refresh (lib/app-auth.ts): body {refreshToken} in, a new
// access token and a new refresh token out. The same rotation as the
// browser's: the presented token is spent, and presenting a spent one again
// ends the whole session (reuse detection).
export async function POST(req: NextRequest) {
  const limited = limitByIp(req, "auth-app-refresh", { windowMs: 60_000, max: 60 });
  if (limited) return limited;
  const outcome = await refreshSession((await refreshTokenFromBody(req)) ?? undefined, req);
  if (!outcome.ok) {
    return appJson(req, { error: { code: "session_ended", message: "Please sign in again." } }, 401);
  }
  const { user, session } = outcome;
  return appSession(req, { id: user.id, email: user.email, role: user.role }, session, ACCESS_TOKEN_TTL_SECONDS);
}

export function OPTIONS(req: NextRequest) {
  return appPreflight(req);
}
