import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { sendAccountSetupInviteEmail } from "@/lib/email";

const PARTNER_MANAGER_ROLES = ["inhouse_supervisor", "director", "admin"] as const;

// POST /api/admin/partners/:id/reset-password (2026-08-01) — same manager
// tier as the rest of Partner CRUD. Unlike staff password resets
// (POST /api/admin/users/:id/reset-password, which hands back a one-time
// temp password shown in the UI), a partner gets the same set-your-own-
// password invite email used at initial provisioning: password_hash is
// cleared so the old password stops working immediately, and the partner
// sets a new one themselves via the link.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...PARTNER_MANAGER_ROLES]);
  if (guardRes) return guardRes;

  const { id } = await params;
  const partner = await prisma.partner.findUnique({ where: { id } });
  if (!partner) {
    return NextResponse.json({ error: { code: "not_found", message: "Partner not found." } }, { status: 404 });
  }
  if (!partner.user_id) {
    return NextResponse.json(
      { error: { code: "no_account", message: "This partner has no login yet — use Create Partner Login instead." } },
      { status: 422 }
    );
  }

  const db = auditedPrisma(user!.userId);
  const linkedUser = await db.user.update({
    where: { id: partner.user_id },
    data: { password_hash: null },
  });

  await sendAccountSetupInviteEmail(linkedUser.id, linkedUser.email, linkedUser.full_name).catch(console.error);

  return NextResponse.json({ data: { email: linkedUser.email } });
}
