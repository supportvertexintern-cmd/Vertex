import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";

// FastAPI owns campaigns and their targets since backend plan step 5.1
// (vertex_be/app/api/v1/campaigns.py): these handlers check the role early,
// pass the request on with callBackend() and answer with FastAPI's
// response. FastAPI re-checks the session, the role, the scoping (an
// In-House Supervisor edits only campaigns they created and targets only
// their own assigned countries) and the input, audits every change, and
// vertex_web may no longer write either table (deploy/db-roles.sql).

// Must match CAMPAIGN_MANAGERS in campaigns.py (tests check it).
const CAMPAIGN_MANAGER_ROLES = ["inhouse_supervisor", "director", "admin"] as const;

// POST /api/campaigns/:id/targets — cascades a numeric target to a
// country, a region, or the whole campaign (SRS FR-3.3).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...CAMPAIGN_MANAGER_ROLES]);
  if (guardRes) return guardRes;

  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }
  return backendResponse(await callBackend(`/api/v1/campaigns/${encodeURIComponent(id)}/targets`, { method: "POST", body }));
}
