import { NextRequest, NextResponse } from "next/server";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { comparePassword } from "@/lib/auth";
import { loginSchema } from "@/lib/validations";
import { emailFingerprint, recordSecurityEvent } from "@/lib/audit";

/**
 * The password check shared by the browser's sign-in (/api/auth/login, which
 * sets cookies) and the mobile app's (/api/auth/app/login, which returns the
 * tokens), so the two can't drift apart. Rate limiting stays in each handler
 * (route-guards.test.ts looks for it there).
 *
 * Every outcome is recorded (Phase 10). Failures keep only a fingerprint of
 * the address, never what was typed, and get the same generic message
 * whether or not the account exists.
 */
export type PasswordLoginResult = { ok: true; user: User } | { ok: false; response: NextResponse };

export async function verifyPasswordLogin(req: NextRequest, client: "web" | "app"): Promise<PasswordLoginResult> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { ok: false, response: NextResponse.json({ error: "Invalid JSON" }, { status: 400 }) };
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors }, { status: 422 }),
    };
  }

  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  const failed = async (reason: string, response: NextResponse): Promise<PasswordLoginResult> => {
    await recordSecurityEvent("login_failed", {
      actorId: null,
      entityType: "Auth",
      entityId: user ? `user:${user.id}` : "unknown_account",
      detail: { reason, method: "password", client, email_fp: emailFingerprint(email) },
    });
    return { ok: false, response };
  };
  const invalid = () => NextResponse.json({ error: "Invalid email or password." }, { status: 401 });

  // Use same generic message for security (avoid user enumeration)
  if (!user || !user.password_hash) return failed(user ? "no_password_set" : "unknown_account", invalid());
  if (!(await comparePassword(password, user.password_hash))) return failed("bad_password", invalid());
  if (!user.email_verified) {
    return failed("email_unverified", NextResponse.json({ error: "Please verify your email before logging in." }, { status: 403 }));
  }

  await recordSecurityEvent("login_succeeded", {
    actorId: user.id,
    entityType: "Auth",
    entityId: `user:${user.id}`,
    detail: { method: "password", client, role: user.role },
  });
  return { ok: true, user };
}
