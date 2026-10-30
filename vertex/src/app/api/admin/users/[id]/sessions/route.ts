import { NextRequest } from "next/server";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { clientHeaders } from "@/lib/auth-backend";
import { seg } from "@/lib/pipeline";

// A user's sessions, for admins. FastAPI keeps them since users step 8.2
// (vertex_be/app/api/v1/sessions.py) and checks the caller is an admin.

// GET /api/admin/users/:id/sessions: a user's live sessions.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;
  const { id } = await params;
  return backendResponse(await callBackend(`/api/v1/users/${seg(id)}/sessions`));
}

// DELETE /api/admin/users/:id/sessions: sign a user out everywhere, at once
// (G19). For offboarding without deleting the account, or a suspected
// compromise. Their next request is refused.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;
  const { id } = await params;
  return backendResponse(await callBackend(`/api/v1/users/${seg(id)}/sessions`, { method: "DELETE", forward: await clientHeaders(req) }));
}
