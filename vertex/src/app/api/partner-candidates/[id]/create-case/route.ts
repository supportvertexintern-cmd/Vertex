import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { HR_ROLES } from "@/lib/rbac";
import { createCaseForApprovedApplication } from "@/server/services/caseLifecycle";
import { sendPartnerCaseCreatedEmail } from "@/lib/email";

import { log } from "@/lib/log";
// PATCH /api/partner-candidates/:id/create-case — the HR review action
// (SRS FR-5.1, 2026-07-31 per the Operational Workflow SOP): HR reviews a
// partner's submission and, on approval, opens a real Case for it, which
// then flows to Operations. Directly promotes the already-bridged
// Candidate straight to "approved" — it never goes through the recruiter/
// supervisor stages in between (reported/verified), since the partner
// already screened/verified this candidate themselves — so this bypasses
// /api/candidates/:id/status's canSetLifecycleStatus transition table
// entirely rather than trying to force this one-off jump through rules
// written for the internal funnel.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, HR_ROLES);
  if (guardRes) return guardRes;

  const { id } = await params;

  const partnerCandidate = await prisma.partnerCandidate.findUnique({
    where: { id, status: { not: "draft" } },
    include: { partner: { select: { name: true, contact_email: true } } },
  });
  if (!partnerCandidate) {
    return NextResponse.json({ error: { code: "not_found", message: "Partner candidate submission not found." } }, { status: 404 });
  }
  if (!partnerCandidate.bridged_candidate_id) {
    return NextResponse.json(
      { error: { code: "not_bridged", message: "This submission has no linked candidate record to create a case for." } },
      { status: 422 }
    );
  }
  if (partnerCandidate.status === "job_assigned") {
    return NextResponse.json({ error: { code: "already_bridged", message: "A case has already been created for this submission." } }, { status: 409 });
  }
  if (partnerCandidate.status === "rejected") {
    return NextResponse.json({ error: { code: "rejected", message: "This submission was rejected — it cannot be bridged to a case." } }, { status: 422 });
  }

  const candidate = await prisma.candidate.findUnique({
    where: { id: partnerCandidate.bridged_candidate_id },
    select: { id: true, full_name: true },
  });
  if (!candidate) {
    return NextResponse.json({ error: { code: "not_found", message: "Linked candidate record no longer exists." } }, { status: 404 });
  }

  const application = await prisma.application.findFirst({
    where: { candidate_id: candidate.id },
    orderBy: { submitted_at: "desc" },
  });
  if (!application) {
    return NextResponse.json({ error: { code: "not_found", message: "No application on file for this candidate." } }, { status: 404 });
  }

  const db = auditedPrisma(user!.userId);

  await db.candidate.update({ where: { id: candidate.id }, data: { lifecycle_status: "approved" } });
  const newCase = await createCaseForApprovedApplication(application.id, user!.userId);
  const updated = await db.partnerCandidate.update({
    where: { id },
    data: { status: "job_assigned", reviewed_by: user!.userId },
  });

  // Deferred via after() — runs post-response but is still guaranteed to
  // complete before the function instance freezes (unlike a bare
  // un-awaited promise), so the request doesn't block on SMTP. Partner
  // only, not the candidate directly (corrected 2026-08-15 — the partner
  // is the sole point of contact for a candidate they sourced; Vertex
  // never emails that candidate directly, mirroring the earlier decision
  // not to collect their phone number at all).
  // A partner without a contact email has nobody to tell.
  const partnerEmail = partnerCandidate.partner.contact_email;
  if (partnerEmail) {
    after(async () => {
      await sendPartnerCaseCreatedEmail(partnerEmail, partnerCandidate.partner.name, candidate.full_name ?? "your candidate").catch((err) => log.error("email.send_failed", { err }));
    });
  }

  return NextResponse.json({ data: { partnerCandidate: updated, case: newCase } });
}
