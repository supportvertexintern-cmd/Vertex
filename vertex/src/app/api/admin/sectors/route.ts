import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { INTERNAL_ROLES } from "@/lib/rbac";
import { backendResponse, callBackend } from "@/lib/backend";

// FastAPI owns sectors and country document requirements since backend
// plan step 2.2 (vertex_be/app/api/v1/reference.py): these handlers check
// the role early, pass the request on with callBackend() and answer with
// FastAPI's response. FastAPI re-checks the session, the role and the input
// itself.

// GET /api/admin/sectors: flat list for every role that fills in a
// Candidate Information Form (its "Preferred Type of Work") or posts jobs.
// Any internal role: FastAPI lets in SECTOR_READERS and whoever holds
// jobs.manage or reference.manage (reference.py).
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, INTERNAL_ROLES);
  if (guardRes) return guardRes;

  return backendResponse(await callBackend("/api/v1/sectors"));
}

// POST /api/admin/sectors: admin only.
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  // Any internal role; FastAPI decides by the reference.manage permission
  // (role management; marketing by default, admin always).
  const guardRes = requireRole(user, INTERNAL_ROLES);
  if (guardRes) return guardRes;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }

  return backendResponse(await callBackend("/api/v1/sectors", { method: "POST", body }));
}
