import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";

// FastAPI owns employer clients since backend plan step 4.1
// (vertex_be/app/api/v1/partners.py): these handlers check the role early,
// pass the request on with callBackend() and answer with FastAPI's
// response. FastAPI re-checks the session, the role and the input itself,
// audits every change, and vertex_web may no longer write the table
// (deploy/db-roles.sql).

// Must match EMPLOYER_CLIENT_READERS / EMPLOYER_CLIENT_MANAGERS in
// partners.py (tests check it). Marketing reads the list to link a job
// posting to a client; In-House Supervisor no longer manages them
// (confirmed with the business).
const EMPLOYER_CLIENT_MANAGER_ROLES = ["director", "admin"] as const;

const path = (id: string) => `/api/v1/employer-clients/${encodeURIComponent(id)}`;

// GET /api/admin/employer-clients/:id — detail, including its linked jobs.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["marketing", "director", "admin"]);
  if (guardRes) return guardRes;

  const { id } = await params;
  return backendResponse(await callBackend(path(id)));
}

// PATCH /api/admin/employer-clients/:id
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...EMPLOYER_CLIENT_MANAGER_ROLES]);
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
