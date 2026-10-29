import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";

// FastAPI owns report writes since backend plan step 5.4
// (vertex_be/app/api/v1/reports.py): this handler checks the role early,
// passes the request on with callBackend() and answers with FastAPI's
// response. FastAPI re-checks the session, the role and the reporting line
// (one controlling position per scope, limited to the reviewer's own
// country or countries), audits every change, and vertex_web may no longer
// write the table (deploy/db-roles.sql).

// Must match REVIEWERS in reports.py (tests check it).
const REVIEWER_ROLES = ["country_supervisor", "inhouse_supervisor", "director", "admin"] as const;

// PATCH /api/reports/:id/verify — the report's one controlling position
// (SRS FR-3.5) approves it as submitted, no changes needed.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...REVIEWER_ROLES]);
  if (guardRes) return guardRes;

  const { id } = await params;
  return backendResponse(await callBackend(`/api/v1/reports/${encodeURIComponent(id)}/verify`, { method: "PATCH" }));
}
