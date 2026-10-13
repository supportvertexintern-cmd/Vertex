import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, requireAuth } from "@/lib/api-auth";
import { recordSecurityEvent } from "@/lib/audit";
import { clearSessionCookies, listSessions, revokeAllForUser } from "@/lib/session";

// GET /api/auth/sessions: the caller's live sessions (browsers and devices
// signed in), for the "Active sessions" panel.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const authError = requireAuth(user);
  if (authError) return authError;
  return NextResponse.json({ data: await listSessions(user!.userId, user!.sid) });
}

// DELETE /api/auth/sessions: log out everywhere, this browser included.
export async function DELETE(req: NextRequest) {
  const user = await getAuthUser(req);
  const authError = requireAuth(user);
  if (authError) return authError;
  const ended = await revokeAllForUser(user!.userId, "logout_everywhere");
  await recordSecurityEvent("sessions_revoked", {
    actorId: user!.userId,
    entityType: "User",
    entityId: user!.userId,
    detail: { reason: "logout_everywhere", sessions: ended },
  });
  const res = NextResponse.json({ data: { ended } });
  clearSessionCookies(res);
  return res;
}
