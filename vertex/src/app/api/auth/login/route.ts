import { NextRequest, NextResponse } from "next/server";
import { setSessionCookies, startSession } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";
import { recordSecurityEvent } from "@/lib/audit";
import { verifyPasswordLogin } from "@/lib/password-login";

// Browser sign-in: the session goes into HttpOnly cookies. The mobile app
// signs in through /api/auth/app/login instead (tokens in the body); both
// share verifyPasswordLogin().
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  // 10 attempts a minute per client. LOGIN_RATE_LIMIT_MAX exists only so the
  // end-to-end suite (many logins from one machine) can raise it; never set
  // it in a real environment.
  const rl = rateLimit(`login:${ip}`, { max: Number(process.env.LOGIN_RATE_LIMIT_MAX) || 10 });
  if (!rl.success) {
    await recordSecurityEvent("login_rate_limited", { actorId: null, entityType: "Auth", entityId: "login", detail: {} });
    return NextResponse.json(
      { error: "Too many login attempts. Please try again later." },
      { status: 429 }
    );
  }

  const login = await verifyPasswordLogin(req, "web");
  if (!login.ok) return login.response;
  const { user } = login;

  const session = await startSession(user, req);

  const res = NextResponse.json({
    message: "Login successful",
    user: {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      role: user.role,
    },
  });
  setSessionCookies(res, session);

  return res;
}
