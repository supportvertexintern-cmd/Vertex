import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import Stripe from "stripe";
import { createReceiptPdf } from "@/lib/invoice";
import { sendConsultationBookingNotification } from "@/lib/email";

import { log } from "@/lib/log";
const stripe = new Stripe((process.env.STRIPE_SECRET_KEY || "sk_test_dummy_key_for_build") as string, {
  apiVersion: "2025-02-24.acacia" as any,
});

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  let event: Stripe.Event;

  try {
    if (!sig || !endpointSecret) throw new Error("Missing stripe signature or secret.");
    event = stripe.webhooks.constructEvent(body, sig, endpointSecret);
  } catch (err: any) {
    log.error("api.webhook_error", { message: `Webhook Error: ${err.message}` });
    return NextResponse.json({ error: `Webhook Error: ${err.message}` }, { status: 400 });
  }

  // Handle successful checkout
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;

    // Case milestone payment links (payments/link route) carry case_id in
    // their metadata — distinct from the application-fee flow's
    // jobId/userId shape below, so branch on whichever is present rather
    // than assuming one or the other. A Checkout Session created by
    // completing a Payment Link carries that link's id back on
    // session.payment_link — matched against the exact
    // stripe_payment_link_id stored on the pending CasePayment row at
    // creation time, rather than case_id+type alone (which could collide
    // if a milestone's link was ever generated more than once).
    // /consultation booking (public, no CRM record exists yet at all) —
    // checked ahead of the case/application branches below since it's the
    // only one with no user_id/case_id to key off, just this metadata flag
    // set at session creation (src/app/api/consultations/checkout/route.ts).
    if (session.metadata?.type === "consultation") {
      const existing = await prisma.consultationBooking.findUnique({
        where: { stripe_checkout_session_id: session.id },
      });
      if (!existing) {
        const details = session.customer_details;
        const booking = await prisma.consultationBooking.create({
          data: {
            full_name: details?.name ?? null,
            email: details?.email ?? "",
            phone: details?.phone ?? null,
            amount: (session.amount_total || 0) / 100,
            currency: (session.currency || "usd").toUpperCase(),
            stripe_checkout_session_id: session.id,
            stripe_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null),
          },
        });
        // Deferred via after() (2026-08-06) — the ConsultationBooking row
        // above is already the durable record, so a slow notification
        // send shouldn't delay Stripe's webhook response (Stripe retries
        // aggressively on a slow/failed response). See screening.ts's
        // screenAndInvite for why after(), not a bare un-awaited promise.
        after(() =>
          sendConsultationBookingNotification({
            fullName: booking.full_name,
            email: booking.email,
            phone: booking.phone,
            amount: booking.amount,
            currency: booking.currency,
          })
        );
      }
      return NextResponse.json({ received: true });
    }

    const caseId = session.metadata?.case_id;
    if (caseId) {
      const paymentLinkId = typeof session.payment_link === "string" ? session.payment_link : session.payment_link?.id;
      if (paymentLinkId) {
        const pending = await prisma.casePayment.findFirst({
          where: { case_id: caseId, stripe_payment_link_id: paymentLinkId, status: "pending" },
        });
        if (pending) {
          await prisma.casePayment.update({
            where: { id: pending.id },
            data: { status: "collected", stripe_checkout_session_id: session.id, recorded_at: new Date() },
          });
        }
      }
      return NextResponse.json({ received: true });
    }

    const { userId, jobId, jobTitle, candidateEmail } = session.metadata || {};
    if (!userId || !jobId) return NextResponse.json({ received: true });

    // Ensure payment not already recorded
    const existing = await prisma.payment.findUnique({ where: { transaction_id: session.payment_intent as string } });
    if (!existing) {
      const payment = await prisma.payment.create({
        data: {
          user_id: userId,
          job_id: jobId,
          amount: (session.amount_total || 0) / 100, // Convert from cents
          currency: "USD",
          payment_method: "stripe",
          payment_status: "completed",
          transaction_id: session.payment_intent as string,
        }
      });

      const user = await prisma.user.findUnique({ where: { id: userId } });

      try {
        if (user) {
          await createReceiptPdf(payment.id, user.full_name, user.email, jobTitle || "Job", payment.amount, payment.transaction_id as string, payment.created_at);
        }
      } catch (receiptErr) {
        log.error("api.failed_to_generate_send_receipt_for_stripe", { err: receiptErr });
      }
    }
  }

  return NextResponse.json({ received: true });
}
