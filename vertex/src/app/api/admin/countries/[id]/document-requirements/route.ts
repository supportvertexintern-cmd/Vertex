import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, requireAdmin, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";

// FastAPI owns sectors and country document requirements since backend
// plan step 2.2 (vertex_be/app/api/v1/reference.py): these handlers check
// the role early, pass the request on with callBackend() and answer with
// FastAPI's response. FastAPI re-checks the session, the role and the input
// itself, and vertex_web may no longer write either table
// (deploy/db-roles.sql).

const path = (id: string) => `/api/v1/countries/${encodeURIComponent(id)}/document-requirements`;

// GET /api/admin/countries/:id/document-requirements: the extra documents
// (beyond the universal passport/photo/CV set) a programme destination
// requires (Candidate Information Form §3's "Required for: X"). The
// candidate reads it too, for their own checklist. Must match
// REQUIREMENT_READERS in reference.py (tests check it).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["candidate", "regional_recruiter", "country_supervisor", "inhouse_supervisor", "director", "marketing", "admin"]);
  if (guardRes) return guardRes;

  const { id } = await params;
  return backendResponse(await callBackend(path(id)));
}

// PUT /api/admin/countries/:id/document-requirements: replaces the
// country's whole list (the admin ticks a checklist). Admin only.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;

  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }

  return backendResponse(await callBackend(path(id), { method: "PUT", body }));
}
