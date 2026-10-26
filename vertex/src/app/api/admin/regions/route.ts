import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, requireAdmin, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";

// FastAPI owns regions and countries since backend plan step 2.1
// (vertex_be/app/api/v1/geography.py): these handlers check the role early,
// pass the request on with callBackend() and answer with FastAPI's response.
// FastAPI re-checks the session, the role and the input itself, and
// vertex_web may no longer write either table (deploy/db-roles.sql).

// GET /api/admin/regions: regions with their countries (SRS FR-1.4). Any
// staff role in the hierarchy reads it (Phase 3 dashboard filters, campaign
// targets). Must match REGION_READERS in geography.py (tests check it).
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["regional_recruiter", "country_supervisor", "inhouse_supervisor", "director", "admin"]);
  if (guardRes) return guardRes;

  return backendResponse(await callBackend("/api/v1/regions"));
}

// POST /api/admin/regions: admin only.
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }

  return backendResponse(await callBackend("/api/v1/regions", { method: "POST", body }));
}
