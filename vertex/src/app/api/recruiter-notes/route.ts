import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";

// FastAPI owns recruiter notes since backend plan step 5.2
// (vertex_be/app/api/v1/targets.py): these handlers check the role early,
// pass the request on with callBackend() and answer with FastAPI's
// response. FastAPI re-checks the session, the role and the management
// hierarchy (read from the database, never from the request), audits every
// change, and vertex_web may no longer write the table (deploy/db-roles.sql).

// GET /api/recruiter-notes?recruiter_id=... — a recruiter reads their own
// notes (recruiter_id defaults to, and must equal, their own id); a
// supervisor reads any one of their own recruiters' notes; admin reads
// anyone's. Roles must match NOTE_READERS in targets.py (tests check it).
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["regional_recruiter", "country_supervisor", "admin"]);
  if (guardRes) return guardRes;

  const recruiterId = req.nextUrl.searchParams.get("recruiter_id");
  return backendResponse(await callBackend("/api/v1/recruiter-notes", { query: recruiterId ? { recruiter_id: recruiterId } : {} }));
}

// POST /api/recruiter-notes — a Country Supervisor leaves a note for one
// of their own recruiters. Roles must match NOTE_WRITERS (tests check it).
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["country_supervisor", "admin"]);
  if (guardRes) return guardRes;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }
  return backendResponse(await callBackend("/api/v1/recruiter-notes", { method: "POST", body }));
}
