import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyReferralAgentEmailVerificationToken } from "@/lib/jwt";
import { limitByIp } from "@/lib/rate-limit";

// GET /api/referral-agents/verify-email — mirrors /api/auth/verify-email,
// but updates ReferralAgent.email_verified. No User/session exists yet at
// this point (the agent isn't approved/provisioned), so this is a public,
// unauthenticated route gated only by the token itself.
export async function GET(req: NextRequest) {
  const limited = limitByIp(req, "referral-agent-verify-email", { windowMs: 15 * 60_000, max: 10 });
  if (limited) return limited;

  const token = req.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "Verification token is required." }, { status: 400 });
  }

  let payload: ReturnType<typeof verifyReferralAgentEmailVerificationToken>;
  try {
    payload = verifyReferralAgentEmailVerificationToken(token);
  } catch {
    return NextResponse.json({ error: "Invalid or expired verification token." }, { status: 400 });
  }

  if (payload.type !== "referral_agent_email_verification") {
    return NextResponse.json({ error: "Invalid token type." }, { status: 400 });
  }

  const agent = await prisma.referralAgent.findUnique({ where: { id: payload.referralAgentId } });
  if (!agent) {
    return NextResponse.json({ error: "Referral agent application not found." }, { status: 404 });
  }

  if (agent.email_verified) {
    return NextResponse.json({ message: "Email is already verified." });
  }

  await prisma.referralAgent.update({
    where: { id: payload.referralAgentId },
    data: { email_verified: true },
  });

  return NextResponse.json({ message: "Email verified! Our team will review your application and let you know the outcome." });
}
