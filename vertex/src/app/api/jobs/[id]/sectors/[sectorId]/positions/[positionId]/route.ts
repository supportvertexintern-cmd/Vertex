import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";

// FastAPI owns a programme's sectors and positions since backend plan step
// 3.3 (vertex_be/app/api/v1/jobs.py): this handler checks the role early,
// passes the request on and answers with FastAPI's response. FastAPI
// re-checks the session, the role, the input and that the ids belong
// together, audits every change, and vertex_web may no longer write either
// table (deploy/db-roles.sql).

// Must match JOB_MANAGERS in vertex_be/app/api/v1/jobs.py (tests check it).
const JOB_MANAGER_ROLES = ["marketing", "admin"] as const;

const path = (id: string, sectorId: string, positionId: string) =>
  `/api/v1/jobs/${encodeURIComponent(id)}/sectors/${encodeURIComponent(sectorId)}/positions/${encodeURIComponent(positionId)}`;

// PATCH /api/jobs/:id/sectors/:sectorId/positions/:positionId — edit a
// position's title/city.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; sectorId: string; positionId: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...JOB_MANAGER_ROLES]);
  if (guardRes) return guardRes;

  const { id, sectorId, positionId } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 }); }

  return backendResponse(await callBackend(path(id, sectorId, positionId), { method: "PATCH", body }));
}

// DELETE /api/jobs/:id/sectors/:sectorId/positions/:positionId
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; sectorId: string; positionId: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...JOB_MANAGER_ROLES]);
  if (guardRes) return guardRes;

  const { id, sectorId, positionId } = await params;
  return backendResponse(await callBackend(path(id, sectorId, positionId), { method: "DELETE" }));
}
