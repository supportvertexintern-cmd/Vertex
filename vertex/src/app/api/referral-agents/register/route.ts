import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { registerReferralAgentSchema } from "@/lib/validations";
import { rateLimit } from "@/lib/rate-limit";
import { generateReferralCode } from "@/lib/referralMilestones";
import { signReferralAgentEmailVerificationToken } from "@/lib/jwt";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

// POST /api/referral-agents/register — public, unauthenticated. Same
// anonymous-submission rate limit as /api/contact and /api/applications.
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const rl = rateLimit(`referral-agent-register:${ip}`, { max: 5, windowMs: 60_000 });
  if (!rl.success) {
    return NextResponse.json({ error: "Too many applications. Please try again later." }, { status: 429 });
  }

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = registerReferralAgentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors }, { status: 422 });
  }

  const existing = await prisma.referralAgent.findUnique({ where: { email: parsed.data.email } });
  if (existing) {
    return NextResponse.json({ error: "An application with this email already exists." }, { status: 409 });
  }

  const country = await prisma.country.findFirst({ where: { name: { equals: parsed.data.country, mode: "insensitive" } } });
  const referral_code = await generateReferralCode(parsed.data.country);

  const agent = await prisma.referralAgent.create({
    data: {
      ...parsed.data,
      date_of_birth: parsed.data.date_of_birth ? new Date(parsed.data.date_of_birth) : undefined,
      country_id: country?.id,
      referral_code,
    },
  });

  const verifyToken = signReferralAgentEmailVerificationToken(agent.id);
  const verifyUrl = `${APP_URL}/become-a-referral-agent/verify-email?token=${verifyToken}`;

  // Deferred via after() (2026-08-06 precedent) — live SMTP sends have been
  // observed taking 30s-150s+, and this response shouldn't block on them.
  after(async () => {
    const { sendReferralAgentApplicationReceivedEmail, sendReferralAgentAdminNotificationEmail } = await import("@/lib/email");
    await sendReferralAgentApplicationReceivedEmail(agent.email, agent.full_name, verifyUrl).catch((err) =>
      console.error("Failed to send referral agent application received email.", err)
    );
    await sendReferralAgentAdminNotificationEmail(agent.full_name, agent.country).catch((err) =>
      console.error("Failed to send referral agent admin notification email.", err)
    );
  });

  return NextResponse.json({ data: { id: agent.id, referral_code: agent.referral_code } }, { status: 201 });
}
