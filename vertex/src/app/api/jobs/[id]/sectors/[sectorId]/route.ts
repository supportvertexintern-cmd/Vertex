import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { INTERNAL_ROLES } from "@/lib/rbac";
import { backendResponse, callBackend } from "@/lib/backend";

// FastAPI owns a programme's sectors and positions since backend plan step
// 3.3 (vertex_be/app/api/v1/jobs.py): this handler checks the role early,
// passes the request on and answers with FastAPI's response. FastAPI
// re-checks the session, the role, the input and that the ids belong
// together and audits every change.

// Who may try: any internal role. FastAPI decides by the jobs.manage
// permission the admin gives roles (role management; marketing by
// default, admin always): vertex_be/app/api/v1/jobs.py.
const JOB_MANAGER_ROLES = INTERNAL_ROLES;

// DELETE /api/jobs/:id/sectors/:sectorId — detaches a sector from this
// programme, with its positions.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; sectorId: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...JOB_MANAGER_ROLES]);
  if (guardRes) return guardRes;

  const { id, sectorId } = await params;
  return backendResponse(await callBackend(`/api/v1/jobs/${encodeURIComponent(id)}/sectors/${encodeURIComponent(sectorId)}`, { method: "DELETE" }));
}
