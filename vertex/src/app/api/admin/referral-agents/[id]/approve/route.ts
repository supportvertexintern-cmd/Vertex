import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { REFERRAL_AGENT_MANAGER_ROLES } from "@/lib/rbac";
import { approveReferralAgentSchema } from "@/lib/validations";
import { sendAccountSetupInviteEmail, sendReferralAgentApprovedEmail } from "@/lib/email";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

// POST /api/admin/referral-agents/:id/approve — Director/Admin only
// (deliberately excludes inhouse_supervisor, unlike PARTNER_MANAGER_ROLES —
// confirmed with the business that this is director-tier, not the
// operational in-house tier). Mirrors provision-account/route.ts: creates
// the agent's own login and sends the same account-setup invite, plus a
// referral-agent-specific approval email with their code/link.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, REFERRAL_AGENT_MANAGER_ROLES);
  if (guardRes) return guardRes;

  const { id } = await params;
  const agent = await prisma.referralAgent.findUnique({ where: { id } });
  if (!agent) {
    return NextResponse.json({ error: { code: "not_found", message: "Referral agent not found." } }, { status: 404 });
  }
  if (agent.status !== "pending_approval") {
    return NextResponse.json({ error: { code: "invalid_transition", message: "Only a pending application can be approved." } }, { status: 409 });
  }
  if (!agent.email_verified) {
    return NextResponse.json({ error: { code: "email_not_verified", message: "This applicant hasn't verified their email yet." } }, { status: 422 });
  }
  if (agent.user_id) {
    return NextResponse.json({ error: { code: "already_provisioned", message: "This agent already has a login." } }, { status: 409 });
  }

  let body: unknown;
  try { body = await req.json(); } catch { body = {}; }

  const parsed = approveReferralAgentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Validation failed", details: parsed.error.flatten().fieldErrors } },
      { status: 422 }
    );
  }

  const email = parsed.data.email ?? agent.email;
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    return NextResponse.json({ error: { code: "duplicate", message: "A user with this email already exists." } }, { status: 409 });
  }

  const db = auditedPrisma(user!.userId);
  const newUser = await db.user.create({
    data: {
      full_name: agent.full_name,
      email,
      role: "referral_agent",
      email_verified: true,
    },
  });
  const updated = await db.referralAgent.update({
    where: { id },
    data: { status: "active", user_id: newUser.id, approved_by_id: user!.userId, approved_at: new Date() },
  });

  const referralLink = `${APP_URL}/apply?ref=${agent.referral_code}`;
  await sendReferralAgentApprovedEmail(agent.email, agent.full_name, agent.referral_code, referralLink).catch(console.error);
  await sendAccountSetupInviteEmail(newUser.id, newUser.email, newUser.full_name).catch(console.error);

  return NextResponse.json({ data: updated }, { status: 201 });
}
