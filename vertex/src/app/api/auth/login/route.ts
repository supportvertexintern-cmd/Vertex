import { NextRequest, NextResponse } from "next/server";
import { setSessionCookies } from "@/lib/session";
import { rateLimit, retryAfter } from "@/lib/rate-limit";
import { clientKey } from "@/lib/client-ip";
import { recordSecurityEvent } from "@/lib/audit";
import { callBackend } from "@/lib/backend";
import { alertOnRefusal, clientHeaders, issued, legacyError, type SignedIn } from "@/lib/auth-backend";

// Browser sign-in: the session goes into HttpOnly cookies. The mobile app
// signs in through /api/auth/app/login instead (tokens in the body). FastAPI
// checks the password and issues the session since users and sessions step
// 8.2 (vertex_be/app/api/v1/sessions.py, login), with the same messages and
// status codes; the per-address limit stays here.
export async function POST(req: NextRequest) {
  const ip = clientKey(req.headers);
  // 10 attempts a minute per client. LOGIN_RATE_LIMIT_MAX exists only so the
  // end-to-end suite (many logins from one machine) can raise it; never set
  // it in a real environment.
  const rl = await rateLimit(`login:${ip}`, { max: Number(process.env.LOGIN_RATE_LIMIT_MAX) || 10 });
  if (!rl.success) {
    await recordSecurityEvent("login_rate_limited", { actorId: null, entityType: "Auth", entityId: "login", detail: {} });
    return NextResponse.json(
      { error: "Too many login attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": retryAfter(rl) } }
    );
  }

  let body: { email?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = await callBackend<SignedIn>("/api/v1/auth/login", {
    method: "POST",
    body: { email: body?.email, password: body?.password, client: "web" },
    asUser: false,
    forward: await clientHeaders(req),
  });
  if (!result.ok) {
    await alertOnRefusal(result);
    return NextResponse.json(legacyError(result.error, result.status), { status: result.status });
  }
  const { user, session } = result.body.data;

  const res = NextResponse.json({
    message: "Login successful",
    user: {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      role: user.role,
    },
  });
  setSessionCookies(res, issued(session));

  return res;
}
