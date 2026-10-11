import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { comparePassword } from "@/lib/auth";
import { signToken } from "@/lib/jwt";
import { loginSchema } from "@/lib/validations";
import { rateLimit } from "@/lib/rate-limit";
import { emailFingerprint, recordSecurityEvent } from "@/lib/audit";

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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  // Phase 10: every outcome is recorded. Failures keep only a fingerprint
  // of the address, never what was typed.
  const failed = (reason: string) =>
    recordSecurityEvent("login_failed", {
      actorId: null,
      entityType: "Auth",
      entityId: user ? `user:${user.id}` : "unknown_account",
      detail: { reason, method: "password", email_fp: emailFingerprint(email) },
    });

  // Use same generic message for security (avoid user enumeration)
  if (!user || !user.password_hash) {
    await failed(user ? "no_password_set" : "unknown_account");
    return NextResponse.json(
      { error: "Invalid email or password." },
      { status: 401 }
    );
  }

  const valid = await comparePassword(password, user.password_hash);
  if (!valid) {
    await failed("bad_password");
    return NextResponse.json(
      { error: "Invalid email or password." },
      { status: 401 }
    );
  }

  if (!user.email_verified) {
    await failed("email_unverified");
    return NextResponse.json(
      { error: "Please verify your email before logging in." },
      { status: 403 }
    );
  }

  await recordSecurityEvent("login_succeeded", {
    actorId: user.id,
    entityType: "Auth",
    entityId: `user:${user.id}`,
    detail: { method: "password", role: user.role },
  });

  const token = signToken({
    userId: user.id,
    email: user.email,
    role: user.role,
  });

  const res = NextResponse.json({
    message: "Login successful",
    user: {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      role: user.role,
    },
  });

  res.cookies.set("auth_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 7 * 24 * 60 * 60, // 7 days
    path: "/",
  });

  return res;
}
