import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { canAccessCandidate } from "@/server/scope";
import { canSetLifecycleStatus, type LifecycleStatus } from "@/server/services/candidateLifecycle";
import { createCaseForApprovedApplication } from "@/server/services/caseLifecycle";
import { screenAndInvite } from "@/server/services/screening";
import { updateCandidateStatusSchema } from "@/lib/validations";
import { sendCandidateApprovedEmail } from "@/lib/email";

// PATCH /api/candidates/:id/status — role-gated lifecycle transition
// (SRS FR-2.4), screening-gate enforced on screened (FR-2.5 — evaluated
// against the Candidate Information Form itself, since no account or
// documents exist yet at this point), and the supervisor
// verification-return workflow (FR-2.7).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [
    "regional_recruiter",
    "country_supervisor",
    "inhouse_supervisor",
    "director",
    "admin",
    "hr",
  ]);
  if (guardRes) return guardRes;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }

  const parsed = updateCandidateStatusSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Validation failed", details: parsed.error.flatten().fieldErrors } },
      { status: 422 }
    );
  }

  const candidate = await prisma.candidate.findUnique({
    where: { id },
    select: {
      lifecycle_status: true,
      user_id: true,
      recruiter_id: true,
      country_id: true,
      full_name: true,
      email: true,
      source: true,
      user: { select: { full_name: true, email: true } },
    },
  });
  if (!candidate) {
    return NextResponse.json({ error: { code: "not_found", message: "Candidate not found." } }, { status: 404 });
  }

  const allowedToTouch = await canAccessCandidate(user!, candidate);
  if (!allowedToTouch) {
    return NextResponse.json({ error: { code: "forbidden", message: "Forbidden." } }, { status: 403 });
  }

  // Conflict-of-interest guard, same principle as document verification:
  // the recruiter who sourced a candidate cannot also perform the
  // supervisor's verify/return action on it, even if their role would
  // otherwise permit it (e.g. an admin who happens to be listed as the
  // sourcing recruiter).
  const target = parsed.data.lifecycle_status as LifecycleStatus;
  const transition = canSetLifecycleStatus(user!.role, candidate.lifecycle_status as LifecycleStatus, target, candidate.source);
  if (!transition.allowed) {
    return NextResponse.json({ error: { code: "invalid_transition", message: transition.reason } }, { status: 422 });
  }

  // A reason is required for any backward return, and also for "rejected"
  // (2026-08-06) — a terminal side-branch, not a STATUS_ORDER return, so
  // isReturn is false for it, but HR still owes the candidate a reason.
  if ((transition.isReturn || target === "rejected") && !parsed.data.return_reason) {
    return NextResponse.json(
      { error: { code: "return_reason_required", message: "A reason is required for this action." } },
      { status: 422 }
    );
  }

  // Screening (and the account-creation invite it triggers on pass) is
  // fully delegated to the shared helper — also the automatic path fired
  // straight off CIF submission (POST /api/applications), so this manual
  // route is now mainly a retry for a candidate who initially failed
  // screening and had their data corrected since.
  if (target === "screened") {
    const result = await screenAndInvite(id, user!.userId);
    if (!result.passed) {
      return NextResponse.json(
        { error: { code: "screening_gate_failed", message: "Candidate has not cleared the screening gate.", details: result.failures } },
        { status: 422 }
      );
    }
    return NextResponse.json({ data: result.candidate });
  }

  const updated = await auditedPrisma(user!.userId).candidate.update({
    where: { id },
    data: {
      lifecycle_status: target,
      return_reason: transition.isReturn || target === "rejected" ? parsed.data.return_reason : null,
    },
    select: {
      id: true,
      lifecycle_status: true,
      return_reason: true,
    },
  });

  // A Case is the start of the Phase 4 mobility lifecycle (SRS FR-4.1/4.2)
  // — it opens once a candidate is actually "Approved by In-House"
  // (Regional Supervisory Operational Workflow p.5), the real trigger,
  // not the legacy Application.application_status field. Attached to
  // their most recent application.
  if (target === "approved") {
    const application = await prisma.application.findFirst({
      where: { candidate_id: id },
      orderBy: { submitted_at: "desc" },
    });
    if (application) {
      await createCaseForApprovedApplication(application.id, user!.userId);
    }

    const recipientEmail = candidate.user?.email ?? candidate.email;
    const recipientName = candidate.user?.full_name ?? candidate.full_name;
    if (recipientEmail && recipientName) {
      await sendCandidateApprovedEmail(recipientEmail, recipientName).catch(console.error);
    }
  }

  return NextResponse.json({ data: updated });
}
