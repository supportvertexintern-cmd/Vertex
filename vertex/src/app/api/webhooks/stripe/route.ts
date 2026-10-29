import { NextRequest, NextResponse } from "next/server";
import { callBackend } from "@/lib/backend";
import { pipelineResponse } from "@/lib/pipeline";

// POST /api/webhooks/stripe — Stripe's public webhook URL. Payments are
// written by FastAPI since payments step 7.2 (owner's decision D1): this
// passes Stripe's request on exactly as it came, body and Stripe-Signature,
// and FastAPI checks the signature itself before writing
// (vertex_be/app/api/v1/payments.py, stripe_webhook): consultation
// bookings, application fees by card, and paid case payment links. This
// app then sends the receipt or booking email FastAPI lists.
//
// Any failure (a bad signature, FastAPI unreachable) answers with an error
// status, and Stripe retries the event for up to three days.
export async function POST(req: NextRequest) {
  const result = await callBackend("/api/v1/payments/stripe/webhook", {
    method: "POST",
    // The exact bytes Stripe signed.
    raw: { body: await req.arrayBuffer(), contentType: req.headers.get("content-type") ?? "application/json" },
    asUser: false,
    forward: { "Stripe-Signature": req.headers.get("stripe-signature") },
  });
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: result.status });
  return pipelineResponse(result, { unwrap: true });
}
