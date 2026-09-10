import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { updateCasePaymentReceiptSchema } from "@/lib/validations";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { canAccessCase } from "@/server/scope";
import { FINANCE_ROLES } from "@/lib/rbac";

// PATCH /api/cases/:id/payments/:paymentId/receipt — Finance replacing,
// attaching, or deleting a payment's invoice/receipt file (2026-08-16).
// Originally replace/delete-only (once a file was uploaded via Send
// Invoice or Mark as Paid, there was no way to swap a wrong one or clear
// it) — also doubles as a first-time attach (2026-08-19) for a payment
// that's already collected but has no receipt at all, mainly the older
// rows caught by the now-fixed cross-milestone-clobbering bug (a shared
// document type meant collecting a later stage silently nulled out an
// earlier stage's receipt_document_id). Works on a payment in either
// status — an emailed "Invoice" (pending) or a confirmed "Receipt"
// (collected) — since both render from the same receipt_document_id.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; paymentId: string }> }) {
  const { id, paymentId } = await params;
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, FINANCE_ROLES);
  if (guardRes) return guardRes;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }

  const parsed = updateCasePaymentReceiptSchema.safeParse(body);
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
  if (!allowed) return NextResponse.json({ error: { code: "forbidden", message: "Forbidden." } }, { status: 403 });

  if (parsed.data.receipt_document_id) {
    const replacementDocument = await prisma.document.findUnique({ where: { id: parsed.data.receipt_document_id } });
    if (!replacementDocument) {
      return NextResponse.json({ error: { code: "not_found", message: "Replacement file not found." } }, { status: 404 });
    }
  }

  const updated = await auditedPrisma(user!.userId).casePayment.update({
    where: { id: paymentId },
    data: { receipt_document_id: parsed.data.receipt_document_id },
  });

  return NextResponse.json({ data: updated });
}
