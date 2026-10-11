import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { limitByIp } from "@/lib/rate-limit";
import { auditedPrisma, recordSecurityEvent } from "@/lib/audit";
import { resetPasswordSchema } from "@/lib/validations";
import { verifyEmailToken } from "@/lib/jwt";
import { hashPassword } from "@/lib/auth";

// POST /api/auth/reset-password — consumes the emailed
// sendPasswordResetEmail link (2026-08-05). No authenticated session
// required — the token itself (24h-expiring, single-purpose) is the
// access grant, same pattern as verify-email.
export async function POST(req: NextRequest) {
  const limited = limitByIp(req, "reset-password", { windowMs: 15 * 60_000, max: 10 });
  if (limited) return limited;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = resetPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors }, { status: 422 });
  }

  let payload: ReturnType<typeof verifyEmailToken>;
  try {
    payload = verifyEmailToken(parsed.data.token, "password_reset");
  } catch {
    await recordSecurityEvent("password_reset_completed", {
      actorId: null, entityType: "Auth", entityId: "invalid_link", detail: { outcome: "invalid_or_expired_link" },
    });
    return NextResponse.json({ error: "This reset link is invalid or has expired. Request a new one." }, { status: 400 });
  }

  if (payload.type !== "password_reset") {
    return NextResponse.json({ error: "Invalid token type." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  if (!user) {
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }

  const password_hash = await hashPassword(parsed.data.password);
  await auditedPrisma(user.id).user.update({
    where: { id: user.id },
    data: { password_hash },
  });
  await recordSecurityEvent("password_reset_completed", {
    actorId: user.id, entityType: "Auth", entityId: `user:${user.id}`, detail: { outcome: "password_changed" },
  });

  return NextResponse.json({ message: "Password reset successfully. You can now log in." });
}
