import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { queryOf } from "@/lib/pipeline";
import { STAFF_ROLES } from "@/lib/rbac";

// GET /api/staff-kpi-targets?staff_id=&cycle= — a staff member's targets
// against what they last reported for one cycle, for themselves (staff_id
// defaults to the caller) or whoever manages their targets. Read from
// FastAPI since reads handover R3 (vertex_be/app/api/v1/dashboards.py).
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, STAFF_ROLES);
  if (guardRes) return guardRes;

  return backendResponse(await callBackend("/api/v1/staff-kpi-targets", { query: queryOf(req, ["staff_id", "cycle"]) }));
}

// POST /api/staff-kpi-targets — upsert one KPI-row target for a direct
// report, keyed to a label their own report's KPI table uses for that
// cycle. FastAPI owns these writes since backend plan step 5.2
// (vertex_be/app/api/v1/targets.py), which re-checks the label
// (app/core/report_templates.py, a tested copy of REPORT_KPI_LABELS) and
// the same three-level hierarchy (can_manage), audits the change.
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, STAFF_ROLES);
  if (guardRes) return guardRes;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }
  return backendResponse(await callBackend("/api/v1/staff-kpi-targets", { method: "POST", body }));
}
