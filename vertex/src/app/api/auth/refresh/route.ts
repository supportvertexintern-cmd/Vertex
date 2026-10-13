import { NextRequest, NextResponse } from "next/server";
import { limitByIp } from "@/lib/rate-limit";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { clearSessionCookies, refreshSession, REFRESH_COOKIE, setSessionCookies } from "@/lib/session";

// Session refresh (G19, lib/session.ts). The refresh cookie is only sent to
// /api/auth/*, so this is the one place a 15-minute access token is renewed.
// Every call spends the presented refresh token and issues a new one.

// POST /api/auth/refresh: from the client fetch wrapper after a 401.
export async function POST(req: NextRequest) {
  const limited = limitByIp(req, "auth-refresh", { windowMs: 60_000, max: 60 });
  if (limited) return limited;
  const outcome = await refreshSession(req.cookies.get(REFRESH_COOKIE)?.value, req);
  if (!outcome.ok) {
    const res = NextResponse.json({ error: { code: "session_ended", message: "Please sign in again." } }, { status: 401 });
    // A lost race leaves the winner's fresh cookies in place.
    if (outcome.reason !== "superseded") clearSessionCookies(res);
    return res;
  }
  const res = NextResponse.json({ data: { role: outcome.user.role } });
  setSessionCookies(res, outcome.session);
  return res;
}

// GET /api/auth/refresh?redirect=/path: src/proxy.ts sends page navigations
// here when the access token is missing or expired. Renews and goes back,
// or goes to sign-in.
export async function GET(req: NextRequest) {
  const target = safeRedirectPath(req.nextUrl.searchParams.get("redirect"));
  const limited = limitByIp(req, "auth-refresh", { windowMs: 60_000, max: 60 });
  if (limited) return limited;
  const outcome = await refreshSession(req.cookies.get(REFRESH_COOKIE)?.value, req);
  if (!outcome.ok) {
    const login = new URL("/auth/login", req.url);
    login.searchParams.set("redirect", target);
    const res = NextResponse.redirect(login, 303);
    if (outcome.reason !== "superseded") clearSessionCookies(res);
    return res;
  }
  const res = NextResponse.redirect(new URL(target, req.url), 303);
  setSessionCookies(res, outcome.session);
  return res;
}
