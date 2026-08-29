import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { FINANCE_ROLES } from "@/lib/rbac";
import { computeMilestoneSplit } from "@/lib/fees";
import { isMilestoneDue } from "@/server/services/paymentSchedule";
import type { CaseStageKey } from "@/components/portal/caseStages";
import type { MilestonePaymentType } from "@prisma/client";

const MILESTONE_TYPES: readonly ("documentation" | "permit" | "visa")[] = ["documentation", "permit", "visa"];

// GET /api/finance/payments-due — Finance's own worklist (2026-07-31, per
// the Operational Workflow SOP): every case whose fee policy is enabled
// and has reached a milestone's trigger stage (paymentSchedule.ts) but has
// no collected payment of that type yet. Only meaningful for a Job-linked
// case — a general-programme application has no pre-provisioned pricing
// to compute a due amount from, same limitation the payment-link feature
// already has.
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
            job: { select: { title: true, service_fee_gbp: true, is_credit_service: true } },
          },
        },
        payments: { where: { status: "collected" }, select: { type: true } },
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
    type: MilestonePaymentType;
    amountDue: number;
    currentStage: CaseStageKey;
  }[] = [];

  for (const c of cases as (typeof cases)[number][]) {
    const job = c.application.job;
    // Credit Service Programme jobs (2026-08-29) are skipped — this
    // worklist is built around the stage-triggered documentation/permit/
    // visa milestone schedule (paymentSchedule.ts), which doesn't apply to
    // their upfront + N-installment structure at all.
    if (!job?.service_fee_gbp || job.is_credit_service) continue;

    const countryId = c.application.candidate.country_id;
    const enabled = (countryId ? policyByCountry.get(countryId) : undefined)?.enabled ?? globalPolicy?.enabled ?? false;
    if (!enabled) continue;

    const collectedTypes = new Set(c.payments.map((p: (typeof c.payments)[number]) => p.type));
    const split = computeMilestoneSplit(job.service_fee_gbp);
    const candidateName = c.application.candidate.user?.full_name ?? c.application.candidate.full_name ?? "— unnamed —";

    for (const type of MILESTONE_TYPES) {
      if (collectedTypes.has(type)) continue;
      if (!isMilestoneDue(type, c.current_stage as CaseStageKey)) continue;
      due.push({
        case_id: c.id,
        candidateName,
        partnerName: c.application.candidate.partner?.name ?? null,
        source: c.application.candidate.source,
        programmeTitle: job.title,
        type,
        amountDue: split[type],
        currentStage: c.current_stage as CaseStageKey,
      });
    }
  }

  return NextResponse.json({ data: due });
}
