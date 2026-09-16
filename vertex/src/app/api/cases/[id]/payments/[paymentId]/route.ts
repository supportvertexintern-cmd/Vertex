import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { canAccessCase } from "@/server/scope";

// DELETE /api/cases/:id/payments/:paymentId — Finance undoing a payment
// record entirely (2026-09-16), not just its receipt — for when "Record"
// (or "Mark as Paid") was clicked in error and no money actually changed
// hands. There was previously no way to correct this: a
// mistakenly-collected CasePayment was permanent, and it also blocked the
// same payment stage from ever being offered again in the Record/Send
// Link/Send Invoice pickers (see dueUnrecordedStages in CaseDetail.tsx).
// Deliberately scoped to the "finance" role only — no Director/Admin
// override, unlike every other payment action (FINANCE_ROLES) — per
// explicit business direction, since this is a correction of Finance's
// own mistake, not a general case-management power. Works on a payment
// in either status — a pending Stripe link/invoice Finance wants to
// cancel, or an already-collected one entered by mistake — the
// underlying issue (a phantom record) is the same either way. Deleting
// is safe: nothing else references CasePayment.id, and its own
// receipt_document_id is onDelete: SetNull, so any attached file is
// orphaned (kept), not deleted.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; paymentId: string }> }) {
  const { id, paymentId } = await params;
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["finance"]);
  if (guardRes) return guardRes;

  const payment = await prisma.casePayment.findUnique({
    where: { id: paymentId },
    include: {
      case: {
        include: {
          application: {
            include: { candidate: { select: { user_id: true, recruiter_id: true, country_id: true, partner_id: true } } },
          },
        },
      },
    },
  });
  if (!payment || payment.case_id !== id) {
    return NextResponse.json({ error: { code: "not_found", message: "Payment not found." } }, { status: 404 });
  }

  const allowed = await canAccessCase(user!, payment.case.application.candidate);
  if (!allowed) return NextResponse.json({ error: { code: "forbidden", message: "Forbidden." } }, { status: 403 });

  await auditedPrisma(user!.userId).casePayment.delete({ where: { id: paymentId } });

  return NextResponse.json({ message: "Payment record removed." });
}
