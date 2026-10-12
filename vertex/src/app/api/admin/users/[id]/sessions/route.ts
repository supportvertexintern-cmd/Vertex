import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";
import { recordSecurityEvent } from "@/lib/audit";
import { listSessions, revokeAllForUser } from "@/lib/session";

// GET /api/admin/users/:id/sessions: a user's live sessions.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;
  const { id } = await params;
  return NextResponse.json({ data: await listSessions(id, null) });
}

// DELETE /api/admin/users/:id/sessions: sign a user out everywhere, at once
// (G19). For offboarding without deleting the account, or a suspected
// compromise. Their next request is refused.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;
  const { id } = await params;
  const target = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!target) {
    return NextResponse.json({ error: { code: "not_found", message: "User not found." } }, { status: 404 });
  }
  const ended = await revokeAllForUser(id, "revoked_by_admin");
  await recordSecurityEvent("sessions_revoked", {
    actorId: user!.userId,
    entityType: "User",
    entityId: id,
    detail: { reason: "revoked_by_admin", sessions: ended },
  });
  return NextResponse.json({ data: { ended } });
}
