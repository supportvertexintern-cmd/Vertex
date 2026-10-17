import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { FINANCE_ROLES } from "@/lib/rbac";
import { computePaymentStageAmounts } from "@/lib/fees";
import { isMilestoneDue } from "@/server/services/paymentSchedule";
import type { CaseStageKey } from "@/components/portal/caseStages";

// GET /api/finance/payments-due — Finance's own worklist (2026-07-31, per
// the Operational Workflow SOP): every case whose fee policy is enabled
// and has reached a payment stage's trigger stage (paymentSchedule.ts) but
// has no collected payment for that stage yet. Only meaningful for a
// Job-linked case — a general-programme application has no pre-provisioned
// pricing to compute a due amount from, same limitation the payment-link
// feature already has. Every Job's payment stages (whatever shape — fixed
// splits or upfront+installments) are treated identically now that they
// all live in JobPaymentStage (2026-09-16, flexible per-Job payment
// stages) — the previous is_credit_service skip no longer applies.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, FINANCE_ROLES);
  if (guardRes) return guardRes;

  const [cases, policies] = await Promise.all([
    prisma.case.findMany({
      include: {
        application: {
          include: {
            candidate: { include: { user: { select: { full_name: true } }, partner: { select: { name: true } } } },
            job: { include: { payment_stages: { orderBy: { order: "asc" } } } },
          },
        },
        payments: { where: { status: "collected" }, select: { job_payment_stage_id: true } },
      },
      orderBy: { updated_at: "desc" },
    }),
    prisma.feePolicy.findMany({ select: { country_id: true, enabled: true } }),
  ]);

  const globalPolicy = policies.find((p: (typeof policies)[number]) => p.country_id === null);
  const policyByCountry = new Map<string, (typeof policies)[number]>(
    policies
      .filter((p: (typeof policies)[number]) => p.country_id !== null)
      .map((p: (typeof policies)[number]) => [p.country_id as string, p])
  );

  const due: {
    case_id: string;
    candidateName: string;
    partnerName: string | null;
    source: string;
    programmeTitle: string;
    job_payment_stage_id: string;
    label: string;
    amountDue: number;
    currentStage: CaseStageKey;
  }[] = [];

  for (const c of cases as (typeof cases)[number][]) {
    const job = c.application.job;
    if (!job?.service_fee_gbp || job.payment_stages.length === 0) continue;

    const countryId = c.application.candidate.country_id;
    const enabled = (countryId ? policyByCountry.get(countryId) : undefined)?.enabled ?? globalPolicy?.enabled ?? false;
    if (!enabled) continue;

    const collectedStageIds = new Set(c.payments.map((p: (typeof c.payments)[number]) => p.job_payment_stage_id));
    const amounts = computePaymentStageAmounts(job.service_fee_gbp, job.payment_stages.map((s: (typeof job.payment_stages)[number]) => s.percent));
    const candidateName = c.application.candidate.user?.full_name ?? c.application.candidate.full_name ?? "— unnamed —";

    job.payment_stages.forEach((stage: (typeof job.payment_stages)[number], i: number) => {
      if (collectedStageIds.has(stage.id)) return;
      if (amounts[i] <= 0) return;
      if (!isMilestoneDue(stage.trigger_stage as CaseStageKey, c.current_stage as CaseStageKey)) return;
      due.push({
        case_id: c.id,
        candidateName,
        partnerName: c.application.candidate.partner?.name ?? null,
        source: c.application.candidate.source,
        programmeTitle: job.title,
        job_payment_stage_id: stage.id,
        label: stage.label,
        amountDue: amounts[i],
        currentStage: c.current_stage as CaseStageKey,
      });
    });
  }

  return NextResponse.json({ data: due });
}
