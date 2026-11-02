import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { passOn } from "@/lib/pipeline";

// Who "sets policy & criteria" for partner agreements (Regional Supervisory
// Operational Workflow p.3) — same manager tier as Fee Policy.
const PARTNER_MANAGER_ROLES = ["inhouse_supervisor", "director", "admin"] as const;

// Read from FastAPI since reads handover R2: partner managers get full rows
// with candidate counts, the other roles only id, name and status (owner's
// decision, 2026-11-02). Roles must match PARTNER_LIST_READERS in
// vertex_be/app/api/v1/partner_agencies.py (tests check it).
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [
    "regional_recruiter", "country_supervisor", "inhouse_supervisor", "director", "admin", "hr", "operations_team", "operations_director", "finance",
  ]);
  if (guardRes) return guardRes;

  return backendResponse(await callBackend("/api/v1/partners"));
}

// POST /api/admin/partners — In-House Supervisor/Director (admin retains override).
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...PARTNER_MANAGER_ROLES]);
  if (guardRes) return guardRes;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }

  // FastAPI writes since users step 8.4 (vertex_be/app/api/v1/partner_agencies.py).
  return passOn("/api/v1/partners", { method: "POST", body });
}
