import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { callBackend, legacyErrorResponse } from "@/lib/backend";
import { FINANCE_ROLES } from "@/lib/rbac";
import { passOn, readJson, seg } from "@/lib/pipeline";

// Read-only visibility on the 3 payment milestones stays with every
// staff tier plus the sourcing partner — only recording one is
// Finance-exclusive (Director/Admin retain override, 2026-07-31).
const PAYMENT_READ_ROLES = ["regional_recruiter", "country_supervisor", "inhouse_supervisor", "director", "admin", "hr", "operations_team", "operations_director", "finance", "partner"] as const;

// POST /api/cases/:id/payments — record a milestone payment (SRS FR-4.5):
// that a payment was collected, with a receipt reference or file, gated by
// the FeePolicy. Recorded by FastAPI since payments step 7.3
// (vertex_be/app/api/v1/case_payments.py, record_payment).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, FINANCE_ROLES);
  if (guardRes) return guardRes;
  const read = await readJson(req, true);
  if (read.invalid) return read.invalid;
  return passOn(`/api/v1/cases/${seg(id)}/payments`, { method: "POST", body: read.body }, { legacyErrors: true });
}

// GET /api/cases/:id/payments — the case's payments, newest first, for
// anyone who may see the case; { data }, or { error }. Read from FastAPI since reads handover R6
// (vertex_be/app/api/v1/payment_reads.py).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...PAYMENT_READ_ROLES]);
  if (guardRes) return guardRes;

  const result = await callBackend(`/api/v1/cases/${seg(id)}/payments`);
  return result.ok ? NextResponse.json(result.body) : legacyErrorResponse(result);
}
