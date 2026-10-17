import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { REFERRAL_AGENT_MANAGER_ROLES } from "@/lib/rbac";
import { sendReferralCommissionApprovedEmail } from "@/lib/email";
import { log } from "@/lib/log";

// POST /api/admin/referral-commissions/:id/approve — pending -> approved.
// A £0 commission never reaches "pending" in the first place (it
// auto-settles as "paid" at generation time), so this route only ever
// operates on a real, payable amount.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, REFERRAL_AGENT_MANAGER_ROLES);
  if (guardRes) return guardRes;

  const { id } = await params;
  const commission = await prisma.referralCommission.findUnique({
    where: { id },
    include: { referral_agent: { select: { email: true, full_name: true } }, candidate: { select: { full_name: true } } },
  });
  if (!commission) {
    return NextResponse.json({ error: { code: "not_found", message: "Commission not found." } }, { status: 404 });
  }
  if (commission.status !== "pending") {
    return NextResponse.json({ error: { code: "not_pending", message: `Already ${commission.status} — nothing to approve.` } }, { status: 422 });
  }

  const updated = await auditedPrisma(user!.userId).referralCommission.update({
    where: { id },
    data: { status: "approved", approved_by_id: user!.userId, approved_at: new Date() },
  });

  await sendReferralCommissionApprovedEmail(
    commission.referral_agent.email,
    commission.referral_agent.full_name,
    commission.candidate.full_name ?? "your referral",
    commission.amount,
    commission.currency
  ).catch((err) => log.error("email.send_failed", { err }));

  return NextResponse.json({ data: updated });
}
