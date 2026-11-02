import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, requireAuth } from "@/lib/api-auth";
import { callBackend, legacyErrorResponse } from "@/lib/backend";

// GET /api/payments/me — the signed-in user's own payments, newest first,
// as a plain array. Read from FastAPI since reads handover R6
// (vertex_be/app/api/v1/payment_reads.py).
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAuth(user);
  if (guardRes) return guardRes;

  const result = await callBackend<unknown[]>("/api/v1/payments/me");
  return result.ok ? NextResponse.json(result.body.data) : legacyErrorResponse(result);
}
