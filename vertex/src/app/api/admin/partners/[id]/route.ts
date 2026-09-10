import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { updatePartnerSchema } from "@/lib/validations";
import { sendAccountSetupInviteEmail } from "@/lib/email";

const PARTNER_MANAGER_ROLES = ["inhouse_supervisor", "director", "admin"] as const;

// GET /api/admin/partners/:id — detail, including candidates it has sourced.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["regional_recruiter", "country_supervisor", "inhouse_supervisor", "director", "admin"]);
  if (guardRes) return guardRes;

  const { id } = await params;
  const partner = await prisma.partner.findUnique({
    where: { id },
    include: {
      candidates: {
        select: {
          id: true,
          full_name: true,
          lifecycle_status: true,
          created_at: true,
          user: { select: { full_name: true, email: true } },
          recruiter: { select: { id: true, full_name: true } },
        },
        orderBy: { created_at: "desc" },
      },
    },
  });
  if (!partner) {
    return NextResponse.json({ error: { code: "not_found", message: "Partner not found." } }, { status: 404 });
  }

  return NextResponse.json({ data: partner });
}

// PATCH /api/admin/partners/:id — every editable field goes through here
// (name, type, country, contact details, status, MOU, notes). Marking
// mou_status "signed" auto-stamps mou_signed_at rather than requiring the
// caller to also supply a timestamp.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...PARTNER_MANAGER_ROLES]);
  if (guardRes) return guardRes;

  const { id } = await params;
  const existing = await prisma.partner.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: { code: "not_found", message: "Partner not found." } }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }

  const parsed = updatePartnerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Validation failed", details: parsed.error.flatten().fieldErrors } },
      { status: 422 }
    );
  }

  // A changed contact_email on a partner that already has its own login
  // (2026-08-01) doubles as their sign-in email — rather than silently
  // drifting the two apart, re-point the linked User at the new address
  // and treat it like a fresh account claim: clear the old password_hash
  // and send the same set-your-password invite used at initial
  // provisioning, so the old password stops working immediately and the
  // new address is implicitly verified by the partner actually opening
  // the email.
  const emailChanged =
    parsed.data.contact_email !== undefined && parsed.data.contact_email !== existing.contact_email;
  if (emailChanged && existing.user_id) {
    const emailTaken = await prisma.user.findFirst({
      where: { email: parsed.data.contact_email, id: { not: existing.user_id } },
    });
    if (emailTaken) {
      return NextResponse.json(
        { error: { code: "duplicate", message: "A user with this email already exists." } },
        { status: 409 }
      );
    }
  }

  const db = auditedPrisma(user!.userId);
  const partner = await db.partner.update({
    where: { id },
    data: {
      ...parsed.data,
      ...(parsed.data.mou_status === "signed" && existing.mou_status !== "signed"
        ? { mou_signed_at: new Date() }
        : {}),
    },
  });

  if (emailChanged && existing.user_id) {
    const linkedUser = await db.user.update({
      where: { id: existing.user_id },
      data: { email: parsed.data.contact_email, password_hash: null },
    });
    await sendAccountSetupInviteEmail(linkedUser.id, linkedUser.email, linkedUser.full_name).catch(console.error);
  }

  return NextResponse.json({ data: partner });
}

// DELETE /api/admin/partners/:id — blocked if the partner has any real
// activity on file (bridged Candidates or PartnerCandidate submissions)
// rather than silently cascading it away — PartnerCandidate.partner_id is
// onDelete: Cascade in the schema, so an unblocked delete here would
// permanently destroy those submission records. A partner with a login
// has that login removed too, since an orphaned partner-role account with
// no Partner row behind it has nothing to sign in to.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...PARTNER_MANAGER_ROLES]);
  if (guardRes) return guardRes;

  const { id } = await params;
  const existing = await prisma.partner.findUnique({
    where: { id },
    select: { id: true, user_id: true, _count: { select: { candidates: true, partner_candidates: true } } },
  });
  if (!existing) {
    return NextResponse.json({ error: { code: "not_found", message: "Partner not found." } }, { status: 404 });
  }

  const activityCount = existing._count.candidates + existing._count.partner_candidates;
  if (activityCount > 0) {
    return NextResponse.json(
      {
        error: {
          code: "has_activity",
          message: `This partner has ${activityCount} candidate submission(s) on file — remove or reassign them first.`,
        },
      },
      { status: 409 }
    );
  }

  const db = auditedPrisma(user!.userId);
  if (existing.user_id) {
    await db.user.delete({ where: { id: existing.user_id } });
  }
  await db.partner.delete({ where: { id } });

  return NextResponse.json({ data: { id } });
}
