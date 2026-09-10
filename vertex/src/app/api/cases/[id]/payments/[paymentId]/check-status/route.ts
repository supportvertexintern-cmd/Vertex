import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { stripe } from "@/lib/stripe";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { canAccessCase } from "@/server/scope";
import { FINANCE_ROLES } from "@/lib/rbac";

// POST /api/cases/:id/payments/:paymentId/check-status — manual
// reconciliation for when the Stripe webhook never fires (or fails,
// or is late) but a candidate/partner reports they've already paid.
// Doesn't depend on the webhook having told us anything first — looks
// up completed Checkout Sessions directly against the payment's own
// Payment Link, the same way Stripe itself would resolve "did anyone pay
// this link yet," so it works even for a payment that's been pending for
// a while with zero webhook deliveries.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; paymentId: string }> }) {
  const { id, paymentId } = await params;
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, FINANCE_ROLES);
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

  // Only the payment fields matter to the caller from here on — drop the
  // nested case/application/candidate relation that was only needed for
  // the access check above, rather than round-tripping it in the response.
  const { case: _case, ...bareLoadedPayment } = payment;

  if (bareLoadedPayment.status !== "pending") {
    return NextResponse.json({ data: bareLoadedPayment, message: `Already ${bareLoadedPayment.status} — nothing to check.` });
  }
  if (!bareLoadedPayment.stripe_payment_link_id) {
    return NextResponse.json(
      { error: { code: "no_payment_link", message: "This payment has no Stripe Payment Link to check against." } },
      { status: 422 }
    );
  }

  let sessions;
  try {
    sessions = await stripe.checkout.sessions.list({ payment_link: bareLoadedPayment.stripe_payment_link_id, limit: 10 });
  } catch (err) {
    console.error(`Failed to check Stripe status for payment ${paymentId}.`, err);
    return NextResponse.json(
      { error: { code: "stripe_check_failed", message: err instanceof Error ? err.message : "Failed to check Stripe." } },
      { status: 502 }
    );
  }

  const paidSession = sessions.data.find((s) => s.payment_status === "paid");
  if (!paidSession) {
    return NextResponse.json({ data: bareLoadedPayment, message: "No completed payment found on Stripe yet." });
  }

  const updated = await auditedPrisma(user!.userId).casePayment.update({
    where: { id: paymentId },
    data: { status: "collected", stripe_checkout_session_id: paidSession.id, recorded_at: new Date() },
  });

  return NextResponse.json({ data: updated, message: "Payment confirmed on Stripe — marked as collected." });
}
