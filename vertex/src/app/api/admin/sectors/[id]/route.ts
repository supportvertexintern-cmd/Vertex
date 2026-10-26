import { NextRequest } from "next/server";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";

// FastAPI owns sectors and country document requirements since backend
// plan step 2.2 (vertex_be/app/api/v1/reference.py): these handlers check
// the role early, pass the request on with callBackend() and answer with
// FastAPI's response. FastAPI re-checks the session, the role and the input
// itself, and vertex_web may no longer write either table
// (deploy/db-roles.sql).

// DELETE /api/admin/sectors/:id: admin only. Applications that chose the
// sector let go of it (SET NULL).
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;

  const { id } = await params;
  return backendResponse(await callBackend(`/api/v1/sectors/${encodeURIComponent(id)}`, { method: "DELETE" }));
}
