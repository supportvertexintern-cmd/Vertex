import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { FINANCE_ROLES } from "@/lib/rbac";

// GET /api/finance/payments-due — Finance's own worklist (2026-07-31, per
// the Operational Workflow SOP): every case whose fee policy is enabled
// and has reached a payment stage's trigger stage but has no collected
// payment for that stage yet. Only meaningful for a Job-linked case with a
// fee and payment stages. Read from FastAPI since reads handover R6
// (vertex_be/app/api/v1/payment_reads.py).
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, FINANCE_ROLES);
  if (guardRes) return guardRes;

  return backendResponse(await callBackend("/api/v1/finance/payments-due"));
}
