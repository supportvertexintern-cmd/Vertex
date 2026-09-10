import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { sendAccountSetupInviteEmail } from "@/lib/email";
import { provisionPartnerAccountSchema } from "@/lib/validations";

const PARTNER_MANAGER_ROLES = ["inhouse_supervisor", "director", "admin"] as const;

// POST /api/admin/partners/:id/provision-account — same manager tier as
// the rest of Partner CRUD (create/status/MOU) creates the partner's own
// login (SRS FR-5.1). Replaces the old temp-password pattern (2026-07-27)
// with the same invite-email flow as POST /api/admin/users — the partner
// sets their own password rather than being handed one out of band.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...PARTNER_MANAGER_ROLES]);
  if (guardRes) return guardRes;

  const { id } = await params;
  const partner = await prisma.partner.findUnique({ where: { id } });
  if (!partner) {
    return NextResponse.json({ error: { code: "not_found", message: "Partner not found." } }, { status: 404 });
  }
  if (partner.user_id) {
    return NextResponse.json({ error: { code: "already_provisioned", message: "This partner already has a login." } }, { status: 409 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }

  const parsed = provisionPartnerAccountSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Validation failed", details: parsed.error.flatten().fieldErrors } },
      { status: 422 }
    );
  }

  const email = parsed.data.email ?? partner.contact_email;
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    return NextResponse.json({ error: { code: "duplicate", message: "A user with this email already exists." } }, { status: 409 });
  }

  const db = auditedPrisma(user!.userId);
  const newUser = await db.user.create({
    data: {
      full_name: partner.contact_name,
      email,
      role: "partner",
      email_verified: false,
    },
  });
  const updatedPartner = await db.partner.update({ where: { id }, data: { user_id: newUser.id } });

  // Awaited, not fire-and-forget — on serverless (Vercel) the function
  // instance can freeze right after the response is sent, silently
  // killing an un-awaited async send before it completes.
  await sendAccountSetupInviteEmail(newUser.id, newUser.email, newUser.full_name).catch(console.error);

  return NextResponse.json({ data: updatedPartner }, { status: 201 });
}
