import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { advanceCaseStageSchema } from "@/lib/validations";
import { getAuthUser, requireRole, forbidden } from "@/lib/api-auth";
import { canAccessCase } from "@/server/scope";
import { canSetCaseStage, type CaseStage } from "@/server/services/caseLifecycle";
import { OPERATIONS_ROLES } from "@/lib/rbac";

import { log } from "@/lib/log";
// PATCH /api/cases/:id/stage — advance or return a case's stage (SRS FR-4.2).
// Operations-owned (2026-07-31, per the Operational Workflow SOP), Director/
// Admin retain override — the other staff tiers keep read-only visibility
// via GET, see src/app/api/cases/route.ts's CASE_ACCESS_ROLES.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, OPERATIONS_ROLES);
  if (guardRes) return guardRes;

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = advanceCaseStageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors }, { status: 422 });
  }

  const caseRecord = await prisma.case.findUnique({
    where: { id },
    include: {
      application: {
        include: {
          candidate: { include: { user: true, partner: { select: { name: true, contact_email: true } } } },
          job: true,
          preferred_sector: true,
        },
      },
      stage_events: { where: { completed_at: null } },
    },
  });
  if (!caseRecord) return NextResponse.json({ error: "Case not found." }, { status: 404 });

  const allowed = await canAccessCase(user!, {
    user_id: caseRecord.application.candidate.user_id,
    recruiter_id: caseRecord.application.candidate.recruiter_id,
    country_id: caseRecord.application.candidate.country_id,
    partner_id: caseRecord.application.candidate.partner_id,
  });
  if (!allowed) return forbidden({ error: "Forbidden." });

  // A rejected case (2026-08-16) is closed — nothing moves it further.
  if (caseRecord.status === "rejected") {
    return NextResponse.json({ error: "This case has been rejected and is closed." }, { status: 422 });
  }

  // CRM Comments item 3 (2026-08-10) — the operational process doesn't
  // move until Operations/Director has confirmed the case's documentation
  // via PATCH /api/cases/:id/ops-review.
  if (caseRecord.ops_review_status !== "confirmed") {
    return NextResponse.json({ error: "Awaiting Operations/Director documentation confirmation before this case can proceed." }, { status: 422 });
  }

  const check = canSetCaseStage(user!.role, caseRecord.current_stage as CaseStage, parsed.data.stage);
  if (!check.allowed) {
    return NextResponse.json({ error: check.reason ?? "Transition not allowed." }, { status: 403 });
  }

  const db = auditedPrisma(user!.userId);

  // Close out the currently-open stage event.
  for (const openEvent of caseRecord.stage_events) {
    await db.caseStageEvent.update({ where: { id: openEvent.id }, data: { completed_at: new Date() } });
  }

  await db.caseStageEvent.create({
    data: {
      case_id: id,
      stage: parsed.data.stage,
      owner_id: user!.userId,
      notes: parsed.data.notes,
    },
  });

  await db.case.update({
    where: { id },
    data: {
      current_stage: parsed.data.stage,
      stage_deadline: parsed.data.stage_deadline ? new Date(parsed.data.stage_deadline) : null,
    },
  });

  // 90-day retention follow-up (SRS FR-4.7) auto-starts once a case
  // reaches the final stage — departure & arrival support.
  if (parsed.data.stage === "departure_arrival_support") {
    const existingFollowUp = await prisma.retentionFollowUp.findUnique({ where: { case_id: id } });
    if (!existingFollowUp) {
      const dueAt = new Date();
      dueAt.setDate(dueAt.getDate() + 90);
      await db.retentionFollowUp.create({ data: { case_id: id, due_at: dueAt } });
    }
  }

  const updated = await prisma.case.findUnique({
    where: { id },
    include: { stage_events: { orderBy: { entered_at: "asc" } } },
  });

  // SRS FR-4.8 + CRM Comments item 2 (2026-08-10, corrected 2026-08-15):
  // automated stage-based notification — best-effort, never blocks the
  // stage change itself. Deferred via after() (2026-08-06), not awaited
  // inline — see screening.ts's screenAndInvite for why after()
  // specifically is needed here rather than a bare un-awaited promise
  // (Vercel can freeze the function right after the response is sent). A
  // self-submitted candidate with a login gets the dashboard-linked
  // email; a partner-sourced candidate is never emailed directly — the
  // partner is their sole point of contact and gets notified instead,
  // same reasoning as not collecting that candidate's phone number at all.
  {
    const { candidate } = caseRecord.application;
    const stage = parsed.data.stage;
    const programmeTitle = caseRecord.application.job?.title ?? caseRecord.application.preferred_sector?.name ?? "your programme";
    after(async () => {
      const { sendCaseStageUpdateEmail, sendPartnerCaseStageUpdateEmail } = await import("@/lib/email");
      if (candidate.user) {
        await sendCaseStageUpdateEmail(candidate.user.email, candidate.user.full_name, programmeTitle, stage).catch((err) =>
          log.error("api.failed_to_send_case_stage_update_email", { err })
        );
      }
      if (candidate.partner) {
        await sendPartnerCaseStageUpdateEmail(
          candidate.partner.contact_email,
          candidate.partner.name,
          candidate.full_name ?? candidate.user?.full_name ?? "Candidate",
          programmeTitle,
          stage
        ).catch((err) => log.error("api.failed_to_send_partner_case_stage_update", { err }));
      }
    });
  }

  return NextResponse.json({ data: updated });
}
