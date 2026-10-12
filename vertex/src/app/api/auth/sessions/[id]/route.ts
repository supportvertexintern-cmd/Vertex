import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, requireAuth } from "@/lib/api-auth";
import { recordSecurityEvent } from "@/lib/audit";
import { clearSessionCookies, revokeFamily } from "@/lib/session";

// DELETE /api/auth/sessions/:id: end one of the caller's own sessions. Scoped
// to the caller, so another user's session id matches nothing (404).
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const authError = requireAuth(user);
  if (authError) return authError;
  const { id } = await params;
  const revoked = await revokeFamily(id, "revoked_by_user", user!.userId);
  if (!revoked) {
    return NextResponse.json({ error: { code: "not_found", message: "Session not found." } }, { status: 404 });
  }
  await recordSecurityEvent("sessions_revoked", {
    actorId: user!.userId,
    entityType: "Session",
    entityId: id,
    detail: { reason: "revoked_by_user", current: id === user!.sid },
  });
  const res = NextResponse.json({ data: { id } });
  if (id === user!.sid) clearSessionCookies(res);
  return res;
}
