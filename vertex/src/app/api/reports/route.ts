import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { queryOf } from "@/lib/pipeline";

const STAFF_ROLES = ["regional_recruiter", "country_supervisor", "inhouse_supervisor", "director", "admin"] as const;

// GET /api/reports — the reports the caller may see (a recruiter their own; a
// country supervisor their own and their country's recruiter reports; an
// In-House Supervisor their countries' and their own portfolio reports; a
// director only In-House reports; admin all), filterable by country, type,
// status, submitter, scope level and name; answers { data, total, page,
// pageSize }. Read from FastAPI since reads handover R3 (vertex_be/app/api/v1/dashboards.py).
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...STAFF_ROLES]);
  if (guardRes) return guardRes;

  const query = queryOf(req, ["country_id", "type", "status", "recruiter_id", "scope_level", "q", "page", "pageSize"]);
  return backendResponse(await callBackend("/api/v1/reports", { query }));
}

// POST /api/reports — submit a new report (SRS FR-3.4; Supervisory
// Reporting Framework §3-§5) at the caller's own scope, consolidating the
// verified child reports it names. FastAPI owns report writes since backend
// plan step 5.4 (vertex_be/app/api/v1/reports.py): it re-checks the
// session, the role, the period rules and the reporting line, audits every
// change, and vertex_web may no longer write the table. This GET stays
// here: it only reads.
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  // Must match SUBMITTERS in reports.py (tests check it).
  const guardRes = requireRole(user, ["regional_recruiter", "country_supervisor", "inhouse_supervisor"]);
  if (guardRes) return guardRes;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }
  return backendResponse(await callBackend("/api/v1/reports", { method: "POST", body }));
}
