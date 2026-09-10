import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { rateLimit } from "@/lib/rate-limit";

const CONSULTATION_FEE_USD = 50;

// POST /api/consultations/checkout — public, unauthenticated. Creates a
// Stripe Checkout Session for the flat $50 /consultation booking fee. No
// pre-payment form: Stripe Checkout itself collects the customer's email
// (required by default) and phone (phone_number_collection below), same
// as the reference site's direct CTA-to-payment-processor flow. The
// resulting ConsultationBooking row is created by the webhook once Stripe
// confirms the charge (src/app/api/webhooks/stripe/route.ts), not here.
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const rl = rateLimit(`consultation-checkout:${ip}`, { max: 5, windowMs: 60_000 });
  if (!rl.success) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    phone_number_collection: { enabled: true },
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: "Vertex Pathway Consultation",
            description: "A 1:1 advisory session on programme fit, visa eligibility, and next steps.",
          },
          unit_amount: CONSULTATION_FEE_USD * 100,
        },
        quantity: 1,
      },
    ],
    metadata: { type: "consultation" },
    success_url: `${appUrl}/consultation/confirmed?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/consultation`,
  });

  return NextResponse.json({ url: session.url });
}
