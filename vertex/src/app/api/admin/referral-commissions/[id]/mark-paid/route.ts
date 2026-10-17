import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { REFERRAL_AGENT_MANAGER_ROLES } from "@/lib/rbac";
import { markReferralCommissionPaidSchema } from "@/lib/validations";
import { sendReferralCommissionPaidEmail } from "@/lib/email";
import { log } from "@/lib/log";

// POST /api/admin/referral-commissions/:id/mark-paid — approved -> paid.
// Mirrors cases/:id/payments/:paymentId/mark-paid's manual confirmation
// shape, but the receipt is optional here (see
// markReferralCommissionPaidSchema) — a deliberate, small divergence from
// Finance's case-payment flow, since a commission already has the
// underlying milestone event as its own record.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, REFERRAL_AGENT_MANAGER_ROLES);
  if (guardRes) return guardRes;

  const { id } = await params;

  let body: unknown;
  try { body = await req.json(); } catch { body = {}; }

  const parsed = markReferralCommissionPaidSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Validation failed", details: parsed.error.flatten().fieldErrors } },
      { status: 422 }
    );
  }

  const commission = await prisma.referralCommission.findUnique({
    where: { id },
    include: { referral_agent: { select: { email: true, full_name: true } }, candidate: { select: { full_name: true } } },
  });
  if (!commission) {
    return NextResponse.json({ error: { code: "not_found", message: "Commission not found." } }, { status: 404 });
  }
  if (commission.status !== "approved") {
    return NextResponse.json({ error: { code: "not_approved", message: `Must be approved before it can be marked paid (currently ${commission.status}).` } }, { status: 422 });
  }

  const updated = await auditedPrisma(user!.userId).referralCommission.update({
    where: { id },
    data: {
      status: "paid",
      paid_by_id: user!.userId,
      paid_at: new Date(),
      payment_reference: parsed.data.payment_reference,
      payment_method: parsed.data.payment_method,
    },
  });

  await sendReferralCommissionPaidEmail(
    commission.referral_agent.email,
    commission.referral_agent.full_name,
    commission.candidate.full_name ?? "your referral",
    commission.amount,
    commission.currency
  ).catch((err) => log.error("email.send_failed", { err }));

  return NextResponse.json({ data: updated });
}
