import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireAuth } from "@/lib/api-auth";
import Stripe from "stripe";

const stripe = new Stripe((process.env.STRIPE_SECRET_KEY || "sk_test_dummy_key_for_build") as string, {
  apiVersion: "2025-02-24.acacia" as any, // Using latest stable or required version
});

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAuth(user);
  if (guardRes) return guardRes;

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = body as { jobId: string };
  if (!parsed.jobId) return NextResponse.json({ error: "Missing jobId" }, { status: 400 });

  const job = await prisma.job.findUnique({ where: { id: parsed.jobId } });
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  if (!job.application_fee || job.application_fee <= 0) {
    return NextResponse.json({ error: "This job does not require an application fee." }, { status: 400 });
  }

  // Create Checkout Session
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
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

  return NextResponse.json({ sessionId: session.id });
}
