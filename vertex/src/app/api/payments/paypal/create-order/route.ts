import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, requireAuth } from "@/lib/api-auth";
import { callBackend } from "@/lib/backend";
import { readJson } from "@/lib/pipeline";

// POST /api/payments/paypal/create-order — a PayPal order for the signed-in
// user's application fee. FastAPI talks to PayPal since payments step 7.2
// (owner's decision D2; vertex_be/app/api/v1/payments.py). Answered as
// before: { id } for the PayPal buttons, { error } otherwise.
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAuth(user);
  if (guardRes) return guardRes;
  const read = await readJson(req, true);
  if (read.invalid) return read.invalid;
  const { jobId } = (read.body ?? {}) as { jobId?: unknown };
  if (!jobId) return NextResponse.json({ error: "Missing jobId" }, { status: 400 });

  const result = await callBackend("/api/v1/payments/paypal/orders", { method: "POST", body: { jobId } });
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: result.status });
  return NextResponse.json({ id: (result.body.data as { id: string }).id });
}
