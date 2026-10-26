import { NextRequest } from "next/server";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";

// DELETE /api/admin/document-types/:id — blocked (409 in_use) while any real
// uploaded Document still references this type; countries that required it
// stop requiring it. FastAPI owns document types since backend plan step
// 3.2 (vertex_be/app/api/v1/reference.py): this handler checks the role
// early and passes the request on.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;

  const { id } = await params;
  return backendResponse(await callBackend(`/api/v1/document-types/${encodeURIComponent(id)}`, { method: "DELETE" }));
}
