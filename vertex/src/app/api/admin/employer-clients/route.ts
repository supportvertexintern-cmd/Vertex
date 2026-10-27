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

// GET /api/admin/employer-clients — every client, by name, with its job count.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["marketing", "director", "admin"]);
  if (guardRes) return guardRes;

  return backendResponse(await callBackend("/api/v1/employer-clients"));
}

// POST /api/admin/employer-clients — Director (admin retains override).
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...EMPLOYER_CLIENT_MANAGER_ROLES]);
  if (guardRes) return guardRes;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }
  return backendResponse(await callBackend("/api/v1/employer-clients", { method: "POST", body }));
}
