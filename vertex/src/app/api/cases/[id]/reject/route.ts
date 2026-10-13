import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { caseRejectSchema } from "@/lib/validations";
import { getAuthUser, requireRole, forbidden } from "@/lib/api-auth";
import { canAccessCase } from "@/server/scope";
import { OPERATIONS_ROLES } from "@/lib/rbac";
import type { Role } from "@prisma/client";

import { log } from "@/lib/log";
// PATCH /api/cases/:id/reject — a real, terminal case-level rejection
// (2026-08-16), distinct from PATCH /api/cases/:id/ops-review's
// documentation-confirmation flag: that one never actually closed
// anything, it only gated stage advancement. This closes the case
// outright — further stage advancement is blocked (see
// PATCH /api/cases/:id/stage), and it drops out of the default case list
// (GET /api/cases) for staff, though the sourcing partner's own case list
// still shows it so they know it happened. Operations/Director need this
// even after HR already created the case, if a genuine problem surfaces
// later. HR also gets it (2026-08-16, added inline rather than widening
// the shared OPERATIONS_ROLES constant, which gates several other
// operations-only routes) — HR's own use case is narrower: undoing a case
// they created by mistake before Operations has started on it, not a
// general operations power.
const CASE_REJECT_ROLES: Role[] = [...OPERATIONS_ROLES, "hr"];

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, CASE_REJECT_ROLES);
  if (guardRes) return guardRes;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }

  const parsed = caseRejectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Validation failed", details: parsed.error.flatten().fieldErrors } },
      { status: 422 }
    );
  }

  const caseRecord = await prisma.case.findUnique({
    where: { id },
    include: {
      application: {
        include: {
          candidate: { include: { partner: { select: { name: true, contact_email: true } } } },
          job: { select: { title: true } },
          preferred_sector: { select: { name: true } },
        },
      },
    },
  });
  if (!caseRecord) return NextResponse.json({ error: { code: "not_found", message: "Case not found." } }, { status: 404 });

  const allowed = await canAccessCase(user!, {
    user_id: caseRecord.application.candidate.user_id,
    recruiter_id: caseRecord.application.candidate.recruiter_id,
    country_id: caseRecord.application.candidate.country_id,
    partner_id: caseRecord.application.candidate.partner_id,
  });
  if (!allowed) return forbidden({ error: { code: "forbidden", message: "Forbidden." } });

  if (caseRecord.status === "rejected") {
    return NextResponse.json({ error: { code: "already_rejected", message: "This case has already been rejected." } }, { status: 409 });
  }

  const db = auditedPrisma(user!.userId);
  const updated = await db.case.update({
    where: { id },
    data: {
      status: "rejected",
      rejected_at: new Date(),
      rejected_by_id: user!.userId,
      rejection_reason: parsed.data.reason,
    },
    select: {
      id: true,
      status: true,
      rejected_at: true,
      rejection_reason: true,
      rejected_by: { select: { full_name: true } },
    },
  });

  // Cascade the closure onto the candidate/application (2026-08-16) — a
  // rejected case previously left both sitting at "approved" (the state
  // set when the case was first created), which read as still active
  // everywhere else in the CRM — the candidate list, the candidate's own
  // detail page, and a self-registered candidate's own "My Applications"
  // dashboard — despite the case itself being closed. Uses the same
  // "rejected" terminal value both fields already have for the unrelated
  // HR-screening-failure case, since the real-world outcome is the same:
  // this application did not succeed.
  await db.candidate.update({
    where: { id: caseRecord.application.candidate.id },
    data: { lifecycle_status: "rejected" },
  });
  await db.application.update({
    where: { id: caseRecord.application.id },
    data: { application_status: "rejected" },
  });

  const candidateName = caseRecord.application.candidate.full_name ?? "the candidate";
  const jobTitle = caseRecord.application.job?.title ?? caseRecord.application.preferred_sector?.name ?? "their programme";
  const { partner } = caseRecord.application.candidate;

  after(async () => {
    const { sendCaseRejectedEmail, sendPartnerCaseRejectedEmail } = await import("@/lib/email");
    const hrUsers = await prisma.user.findMany({ where: { role: "hr" }, select: { email: true, full_name: true } });
    await Promise.all(
      hrUsers.map((hrUser: (typeof hrUsers)[number]) =>
        sendCaseRejectedEmail(hrUser.email, hrUser.full_name, candidateName, jobTitle, parsed.data.reason).catch((err) =>
          log.error("api.failed_to_send_hr_case_rejected_email", { err })
        )
      )
    );
    if (partner) {
      await sendPartnerCaseRejectedEmail(partner.contact_email, partner.name, candidateName, jobTitle, parsed.data.reason).catch((err) =>
        log.error("api.failed_to_send_partner_case_rejected_email", { err })
      );
    }
  });

  return NextResponse.json({ data: updated });
}
