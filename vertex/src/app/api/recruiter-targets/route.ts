import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";

// FastAPI owns recruiter targets since backend plan step 5.2
// (vertex_be/app/api/v1/targets.py): these handlers check the role early,
// pass the request on with callBackend() and answer with FastAPI's
// response. FastAPI re-checks the session, the role and the management
// hierarchy (read from the database, never from the request), audits every
// change, and vertex_web may no longer write the table (deploy/db-roles.sql).

// Must match TARGET_READERS / TARGET_SETTERS in targets.py (tests check
// it). A Country Supervisor allocates their country's campaign target
// across their own recruiters; admin keeps override.
const STAFF_ROLES = ["regional_recruiter", "country_supervisor", "inhouse_supervisor", "director", "admin"] as const;
const TARGET_SETTER_ROLES = ["country_supervisor", "admin"] as const;

// GET /api/recruiter-targets?campaign_target_id=... — scoped: a recruiter
// sees only their own allocation, a supervisor their own recruiters',
// management/admin everything.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...STAFF_ROLES]);
  if (guardRes) return guardRes;

  const campaignTargetId = req.nextUrl.searchParams.get("campaign_target_id");
  return backendResponse(await callBackend("/api/v1/recruiter-targets", { query: campaignTargetId ? { campaign_target_id: campaignTargetId } : {} }));
}

// POST /api/recruiter-targets — sets one recruiter's allocation of a
// campaign target: only for a recruiter the supervisor supervises, against
// a campaign target scoped to that recruiter's country.
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...TARGET_SETTER_ROLES]);
  if (guardRes) return guardRes;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }
  return backendResponse(await callBackend("/api/v1/recruiter-targets", { method: "POST", body }));
}
