import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, requireAuth } from "@/lib/api-auth";
import { callBackend, legacyErrorResponse } from "@/lib/backend";
import Stripe from "stripe";
import { STRIPE_API_VERSION, CARD_ONLY_CHECKOUT } from "@/lib/stripe";

const stripe = new Stripe((process.env.STRIPE_SECRET_KEY || "sk_test_dummy_key_for_build") as string, {
  apiVersion: STRIPE_API_VERSION,
});

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAuth(user);
  if (guardRes) return guardRes;

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = body as { jobId: string };
  if (!parsed.jobId) return NextResponse.json({ error: "Missing jobId" }, { status: 400 });

  // The fee is never on the public job: FastAPI gives it to a signed-in
  // user (reads handover R1).
  const found = await callBackend<{ id: string; title: string; application_fee: number | null }>(
    `/api/v1/jobs/${encodeURIComponent(parsed.jobId)}/application-fee`
  );
  if (!found.ok) return legacyErrorResponse(found);
  const job = found.body.data;
  if (!job.application_fee || job.application_fee <= 0) {
    return NextResponse.json({ error: "This job does not require an application fee." }, { status: 400 });
  }

  // Create Checkout Session
  const session = await stripe.checkout.sessions.create({
    ...CARD_ONLY_CHECKOUT,
    customer_email: user!.email,
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: `Application Fee: ${job.title}`,
            description: `Processing fee for Vertex International application.`,
          },
          unit_amount: Math.round(job.application_fee * 100), // Stripe expects cents
        },
        quantity: 1,
      },
    ],
    metadata: {
      userId: user!.userId,
      jobId: job.id,
      jobTitle: job.title,
      candidateEmail: user!.email
    },
    mode: "payment",
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/apply?jobId=${job.id}&payment=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/jobs/${job.id}/pay`,
  });

  return NextResponse.json({ sessionId: session.id, url: session.url });
}
