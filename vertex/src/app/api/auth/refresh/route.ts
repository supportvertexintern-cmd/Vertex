import { NextRequest, NextResponse } from "next/server";
import { limitByIp } from "@/lib/rate-limit";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { callBackend } from "@/lib/backend";
import { alertOnRefusal, clientHeaders, issued, refreshRefusal, type SignedIn } from "@/lib/auth-backend";
import { clearSessionCookies, REFRESH_COOKIE, setSessionCookies } from "@/lib/session";

// Session refresh (G19). The refresh cookie is only sent to /api/auth/*, so
// this is the one place a 15-minute access token is renewed. FastAPI spends
// the presented refresh token and issues a new one since users step 8.2
// (vertex_be/app/api/v1/sessions.py, refresh); this route sets the cookies.

async function refresh(req: NextRequest) {
  const result = await callBackend<SignedIn>("/api/v1/auth/refresh", {
    method: "POST",
    body: { refresh_token: req.cookies.get(REFRESH_COOKIE)?.value ?? null },
    asUser: false,
    forward: await clientHeaders(req),
  });
  if (!result.ok) await alertOnRefusal(result);
  return result;
}

// POST /api/auth/refresh: from the client fetch wrapper after a 401.
export async function POST(req: NextRequest) {
  const limited = limitByIp(req, "auth-refresh", { windowMs: 60_000, max: 60 });
  if (limited) return limited;
  const result = await refresh(req);
  if (!result.ok) {
    const refused = refreshRefusal(result);
    // FastAPI unreachable isn't a refusal: the cookies stay for the retry.
    if (!refused) return NextResponse.json({ error: result.error }, { status: result.status });
    const res = NextResponse.json({ error: { code: "session_ended", message: "Please sign in again." } }, { status: 401 });
    // A lost race leaves the winner's fresh cookies in place.
    if (refused !== "superseded") clearSessionCookies(res);
    return res;
  }
  const res = NextResponse.json({ data: { role: result.body.data.user.role } });
  setSessionCookies(res, issued(result.body.data.session));
  return res;
}

// GET /api/auth/refresh?redirect=/path: src/proxy.ts sends page navigations
// here when the access token is missing or expired. Renews and goes back,
// or goes to sign-in.
export async function GET(req: NextRequest) {
  const target = safeRedirectPath(req.nextUrl.searchParams.get("redirect"));
  const limited = limitByIp(req, "auth-refresh", { windowMs: 60_000, max: 60 });
  if (limited) return limited;
  const result = await refresh(req);
  if (!result.ok) {
    const login = new URL("/auth/login", req.url);
    login.searchParams.set("redirect", target);
    const res = NextResponse.redirect(login, 303);
    const refused = refreshRefusal(result);
    if (refused && refused !== "superseded") clearSessionCookies(res);
    return res;
  }
  const res = NextResponse.redirect(new URL(target, req.url), 303);
  setSessionCookies(res, issued(result.body.data.session));
  return res;
}
