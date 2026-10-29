import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, requireAuth } from "@/lib/api-auth";
import { callBackend } from "@/lib/backend";
import { pipelineResponse, readJson, seg } from "@/lib/pipeline";

// POST /api/payments/paypal/capture-order — captures the user's approved
// PayPal order and records the fee. FastAPI talks to PayPal since payments
// step 7.2 (owner's decision D2; vertex_be/app/api/v1/payments.py), and
// first checks with PayPal that the order is this user's, for this job's
// fee. This app sends the PDF receipt it lists. Answered as before.
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAuth(user);
  if (guardRes) return guardRes;
  const read = await readJson(req, true);
  if (read.invalid) return read.invalid;
  const { orderID, jobId } = (read.body ?? {}) as { orderID?: unknown; jobId?: unknown };
  if (typeof orderID !== "string" || !orderID || !jobId) return NextResponse.json({ error: "Missing required fields" }, { status: 400 });

  const result = await callBackend(`/api/v1/payments/paypal/orders/${seg(orderID)}/capture`, { method: "POST", body: { jobId } });
  return pipelineResponse(result, {
    unwrap: true,
    legacyErrors: true,
    reshape: (data) => ({ success: true, paymentId: (data as { id: string }).id }),
  });
}
