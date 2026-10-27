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
// Must match CAMPAIGN_READERS in campaigns.py (tests check it): a recruiter
// needs to see what campaign targets apply to their work.
const STAFF_ROLES = ["regional_recruiter", "country_supervisor", "inhouse_supervisor", "director", "admin"] as const;

const path = (id: string) => `/api/v1/campaigns/${encodeURIComponent(id)}`;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...STAFF_ROLES]);
  if (guardRes) return guardRes;

  const { id } = await params;
  return backendResponse(await callBackend(path(id)));
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
  return backendResponse(await callBackend(path(id), { method: "PATCH", body }));
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...CAMPAIGN_MANAGER_ROLES]);
  if (guardRes) return guardRes;

  const { id } = await params;
  return backendResponse(await callBackend(path(id), { method: "DELETE" }));
}
