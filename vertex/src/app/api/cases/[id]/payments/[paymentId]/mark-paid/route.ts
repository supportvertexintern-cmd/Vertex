import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { markCasePaymentPaidSchema } from "@/lib/validations";
import { getAuthUser, requireRole, forbidden } from "@/lib/api-auth";
import { canAccessCase } from "@/server/scope";
import { FINANCE_ROLES } from "@/lib/rbac";

// POST /api/cases/:id/payments/:paymentId/mark-paid — Finance manually
// confirms a pending payment was received (2026-08-04), with a real
// uploaded receipt (bank transfer confirmation, etc.) — required, not
// optional, since there's no webhook backing this the way there is for a
// Stripe payment link; the file is the only actual proof. The bank-
// transfer equivalent of check-status. Works on any pending payment, not
// just invoice-originated ones, since a Stripe Payment Link's own
// check-status route already covers that case — this is just the other
// path to the same "mark collected" outcome.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; paymentId: string }> }) {
  const { id, paymentId } = await params;
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, FINANCE_ROLES);
  if (guardRes) return guardRes;

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 }); }

  const parsed = markCasePaymentPaidSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "Validation failed" } },
      { status: 422 }
    );
  }

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
  if (!allowed) return forbidden({ error: { code: "forbidden", message: "Forbidden." } });

  if (payment.status !== "pending") {
    return NextResponse.json({ error: { code: "not_pending", message: `Already ${payment.status} — nothing to mark.` } }, { status: 422 });
  }

  const receiptDocument = await prisma.document.findUnique({ where: { id: parsed.data.receipt_document_id } });
  if (!receiptDocument) {
    return NextResponse.json({ error: { code: "not_found", message: "Receipt document not found." } }, { status: 404 });
  }

  const updated = await auditedPrisma(user!.userId).casePayment.update({
    where: { id: paymentId },
    data: { status: "collected", recorded_at: new Date(), receipt_document_id: parsed.data.receipt_document_id },
  });

  return NextResponse.json({ data: updated, message: "Marked as paid." });
}
