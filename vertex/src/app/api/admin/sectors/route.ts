import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, requireAdmin, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";

// FastAPI owns sectors and country document requirements since backend
// plan step 2.2 (vertex_be/app/api/v1/reference.py): these handlers check
// the role early, pass the request on with callBackend() and answer with
// FastAPI's response. FastAPI re-checks the session, the role and the input
// itself, and vertex_web may no longer write either table
// (deploy/db-roles.sql).

// GET /api/admin/sectors: flat list for every role that fills in a
// Candidate Information Form (its "Preferred Type of Work") or posts jobs.
// Must match SECTOR_READERS in reference.py (tests check it).
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["regional_recruiter", "country_supervisor", "inhouse_supervisor", "director", "marketing", "admin"]);
  if (guardRes) return guardRes;

  return backendResponse(await callBackend("/api/v1/sectors"));
}

// POST /api/admin/sectors: admin only.
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

  return backendResponse(await callBackend("/api/v1/sectors", { method: "POST", body }));
}
