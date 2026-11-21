import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { INTERNAL_ROLES } from "@/lib/rbac";
import { backendResponse, callBackend } from "@/lib/backend";

// DELETE /api/admin/document-types/:id — blocked (409 in_use) while any real
// uploaded Document still references this type; countries that required it
// stop requiring it. FastAPI owns document types since backend plan step
// 3.2 (vertex_be/app/api/v1/reference.py): this handler checks the role
// early and passes the request on.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  // Any internal role; FastAPI decides by the reference.manage permission
  // (role management; marketing by default, admin always).
  const guardRes = requireRole(user, INTERNAL_ROLES);
  if (guardRes) return guardRes;

  const { id } = await params;
  return backendResponse(await callBackend(`/api/v1/document-types/${encodeURIComponent(id)}`, { method: "DELETE" }));
}
