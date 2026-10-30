import { NextRequest } from "next/server";
import { getAuthUser, requireAuth } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { clientHeaders } from "@/lib/auth-backend";
import { seg } from "@/lib/pipeline";
import { clearSessionCookies } from "@/lib/session";

// DELETE /api/auth/sessions/:id: end one of the caller's own sessions. Scoped
// to the caller by FastAPI (users step 8.2), so another user's session id
// matches nothing (404). Ending this browser's own session clears its cookies.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const authError = requireAuth(user);
  if (authError) return authError;
  const { id } = await params;
  const result = await callBackend(`/api/v1/auth/sessions/${seg(id)}`, { method: "DELETE", forward: await clientHeaders(req) });
  const res = backendResponse(result);
  if (result.ok && id === user!.sid) clearSessionCookies(res);
  return res;
}
