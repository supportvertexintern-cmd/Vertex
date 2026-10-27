import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import type { Role } from "@prisma/client";

// FastAPI owns staff scorecards since backend plan step 5.3
// (vertex_be/app/api/v1/scorecards.py): these handlers check the role
// early, pass the request on with callBackend() and answer with FastAPI's
// response. FastAPI re-checks the session, the role and the reporting line
// (only the staff member's own supervisor scores them; admin keeps
// override), computes the score, category and required action when a
// scorecard is finalized, audits every change, and vertex_web may no
// longer write either table (deploy/db-roles.sql).

// Must match SCORECARD_REVIEWERS in scorecards.py (tests check it).
const REVIEWER_ROLES: Role[] = ["country_supervisor", "inhouse_supervisor", "director", "admin"];

// PATCH /api/staff-scorecards/:id — finalize a draft scorecard: FastAPI
// computes the weighted overall score from its rated areas, derives the
// performance category and required action, and locks it.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, REVIEWER_ROLES);
  if (guardRes) return guardRes;

  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }
  return backendResponse(await callBackend(`/api/v1/staff-scorecards/${encodeURIComponent(id)}`, { method: "PATCH", body }));
}
