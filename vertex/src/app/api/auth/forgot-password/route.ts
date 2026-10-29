import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { limitByIp } from "@/lib/rate-limit";
import { forgotPasswordSchema } from "@/lib/validations";
import { sendPasswordResetEmail } from "@/lib/email";
import { emailFingerprint, recordSecurityEvent } from "@/lib/audit";
import { log } from "@/lib/log";

const GENERIC_MESSAGE = "If an account exists for that email, we've sent a password reset link.";

// POST /api/auth/forgot-password — self-service reset request from the
// login page (2026-08-05). Always returns the same generic message
// regardless of whether the email matched a real account, so this can't
// be used to enumerate registered users. Only actually sends an email
// when there's a real, login-capable account behind it (password_hash
// set) — a candidate lead or not-yet-provisioned staff/partner account
// has nothing to reset yet.
export async function POST(req: NextRequest) {
  const limited = limitByIp(req, "forgot-password", { windowMs: 15 * 60_000, max: 5 });
  if (limited) return limited;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = forgotPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors }, { status: 422 });
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true, email: true, full_name: true, password_hash: true },
  });

  await recordSecurityEvent("password_reset_requested", {
    actorId: null,
    entityType: "Auth",
    entityId: user ? `user:${user.id}` : "unknown_account",
    detail: { email_fp: emailFingerprint(parsed.data.email), email_sent: Boolean(user?.password_hash) },
  });

  if (user?.password_hash) {
    // Deferred via after() (2026-08-06) — the response is the same generic
    // message either way, so nothing depends on waiting for this to
    // finish. See lib/pipeline.ts (sendNotices) for why after(), not a
    // bare un-awaited promise.
    after(async () => {
      try {
        await sendPasswordResetEmail(user.id, user.email, user.full_name);
      } catch (err) {
        log.error("email.password_reset_failed", { user_id: user.id, err });
      }
    });
  }

  return NextResponse.json({ message: GENERIC_MESSAGE });
}
