import { NextRequest } from "next/server";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { clientHeaders } from "@/lib/auth-backend";
import { seg } from "@/lib/pipeline";

// DELETE /api/admin/users/:id/sessions/:sessionId: ends one session of a
// user, from the admin's account view. FastAPI scopes it to that user
// (vertex_be/app/api/v1/sessions.py).
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; sessionId: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;
  const { id, sessionId } = await params;
  return backendResponse(
    await callBackend(`/api/v1/users/${seg(id)}/sessions/${seg(sessionId)}`, { method: "DELETE", forward: await clientHeaders(req) }),
  );
}
