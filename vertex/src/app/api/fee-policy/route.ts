import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { backendResponse, callBackend } from "@/lib/backend";
import { getAuthUser, requireRole } from "@/lib/api-auth";

// Pricing now lives per-Job (the opportunities catalog's service_fee_gbp
// etc.), not a separate country-level policy an In-House Supervisor
// manages — confirmed with the business, In-House no longer edits this
// (kept Director/admin-only). Still readable by every staff role below.
const FEE_POLICY_MANAGER_ROLES = ["director", "admin"] as const;

// GET /api/fee-policy — readable by any staff role (a recruiter recording
// a payment needs to know whether it's enabled), editable by Director
// (admin retains override) — see the FEE_POLICY_MANAGER_ROLES note above.
// Widened to hr/operations_team/operations_director/finance/partner
// (2026-07-31) — CaseDetail.tsx calls this unconditionally on every load
// to compute its "Milestone payments not enabled" banner, and it's now
// rendered by their portals too.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [
    "regional_recruiter",
    "country_supervisor",
    "inhouse_supervisor",
    "director",
    "admin",
    "hr",
    "operations_team",
    "operations_director",
    "finance",
    "partner",
  ]);
  if (guardRes) return guardRes;

  const policies = await prisma.feePolicy.findMany({ include: { country: { select: { name: true } } }, orderBy: { updated_at: "desc" } });
  return NextResponse.json({ data: policies });
}

// POST /api/fee-policy: SRS FR-4.5, milestone-payment policy, defaults
// disabled; one policy per country (null = global default). FastAPI owns
// FeePolicy since the reference-data handover (backend plan step 1.2): this
// passes the request on and answers with FastAPI's response. FastAPI checks
// the session, the role and the input itself (vertex_be/app/api/v1/
// fee_policy.py); the role check here only saves a round trip, and
// vertex_web can no longer write the table (deploy/db-roles.sql).
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...FEE_POLICY_MANAGER_ROLES]);
  if (guardRes) return guardRes;

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 }); }

  return backendResponse(await callBackend("/api/v1/fee-policy", { method: "POST", body }));
}
