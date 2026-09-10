import { prisma } from "@/lib/prisma";
import type { Prisma, CandidateLifecycleStatus, CampaignMetric, CampaignTarget, RecruiterTarget, ReportCycle } from "@prisma/client";

export interface KpiFilters {
  // A single id for most callers; an array for an In-House Supervisor
  // scoped to several assigned countries (2026-07) — widened here rather
  // than adding a parallel countryIds field, since every existing caller
  // that only ever had one id keeps working unchanged.
  countryId?: string | string[];
  regionId?: string;
  recruiterId?: string;
  periodStart: Date;
  periodEnd: Date;
}

const LIFECYCLE_ORDER: CandidateLifecycleStatus[] = [
  "identified",
  "screened",
  "guided_to_apply",
  "submitted",
  "reported",
  "verified",
  "approved",
];

function candidateWhere(filters: KpiFilters): Prisma.CandidateWhereInput {
  return {
    created_at: { gte: filters.periodStart, lte: filters.periodEnd },
    ...(filters.recruiterId ? { recruiter_id: filters.recruiterId } : {}),
    ...(filters.countryId
      ? { country_id: Array.isArray(filters.countryId) ? { in: filters.countryId } : filters.countryId }
      : {}),
    ...(filters.regionId ? { country: { region_id: filters.regionId } } : {}),
  };
}

/**
 * "Agent sign-ups" (SRS FR-3.2): new candidates the agent network brought
 * in during the period, at whatever scope (recruiter/country/region/all)
 * the caller asks for.
 */
export async function computeAgentSignups(filters: KpiFilters): Promise<number> {
  return prisma.candidate.count({ where: candidateWhere(filters) });
}

/**
 * "Agency response rate" (SRS FR-3.2) has no further definition in the SRS
 * — interpreted here as how responsive the recruiter network itself was:
 * the percentage of candidates identified in the period who were actually
 * screened (i.e. got a real follow-up from their recruiter), not left
 * sitting at "identified". Documented as a deliberate, disclosed
 * interpretation, kept as-is now that Partner exists (Phase 5) rather than
 * repurposed — see computePartnerPerformance for the genuine partner-based
 * metric that entity enables.
 */
export async function computeRecruiterResponseRate(filters: KpiFilters): Promise<number> {
  const where = candidateWhere(filters);
  const [total, responded] = await Promise.all([
    prisma.candidate.count({ where }),
    prisma.candidate.count({
      where: { ...where, lifecycle_status: { not: "identified" } },
    }),
  ]);
  return total === 0 ? 0 : Math.round((responded / total) * 1000) / 10;
}

/** "Applicant flow" (SRS FR-3.2): funnel counts by pre-application lifecycle stage. */
export async function computeApplicantFlow(filters: KpiFilters): Promise<Record<CandidateLifecycleStatus, number>> {
  const rows = await prisma.candidate.groupBy({
    by: ["lifecycle_status"],
    where: candidateWhere(filters),
    _count: { _all: true },
  });
  const flow = Object.fromEntries(LIFECYCLE_ORDER.map((s) => [s, 0])) as Record<CandidateLifecycleStatus, number>;
  for (const row of rows) {
    const status = row.lifecycle_status as CandidateLifecycleStatus;
    flow[status] = row._count?._all ?? 0;
  }
  return flow;
}

export interface StageConversion {
  from: CandidateLifecycleStatus;
  to: CandidateLifecycleStatus;
  rate: number;
}

function reachedOrLaterFromFlow(flow: Record<CandidateLifecycleStatus, number>, idx: number): number {
  return LIFECYCLE_ORDER.slice(idx).reduce((sum, status) => sum + flow[status], 0);
}

function verifiedCandidatesFromFlow(flow: Record<CandidateLifecycleStatus, number>): number {
  return reachedOrLaterFromFlow(flow, LIFECYCLE_ORDER.indexOf("verified"));
}

function conversionOverallFromFlow(flow: Record<CandidateLifecycleStatus, number>): number {
  const totalVerified = verifiedCandidatesFromFlow(flow);
  return totalVerified === 0 ? 0 : Math.round((flow.approved / totalVerified) * 1000) / 10;
}

// A campaign target's scope (country/region/recruiter + period) is what
// determines its applicant-flow query — several targets on the same
// campaign, or several metrics on the same target's scope, very
// plausibly share one. Caching computeApplicantFlow per unique scope
// within one targets-vs-actuals call means N targets sharing a scope
// cost one groupBy query, not N.
function kpiScopeKey(filters: KpiFilters): string {
  const countryKey = Array.isArray(filters.countryId) ? [...filters.countryId].sort().join(",") : filters.countryId ?? "";
  return `${countryKey}|${filters.regionId ?? ""}|${filters.recruiterId ?? ""}|${filters.periodStart.getTime()}|${filters.periodEnd.getTime()}`;
}

function createFlowCache() {
  const cache = new Map<string, Promise<Record<CandidateLifecycleStatus, number>>>();
  return (filters: KpiFilters) => {
    const key = kpiScopeKey(filters);
    let pending = cache.get(key);
    if (!pending) {
      pending = computeApplicantFlow(filters);
      cache.set(key, pending);
    }
    return pending;
  };
}

/**
 * "Verified candidates" (campaign-target metric, redefined 2026-07-13):
 * candidates who reached "verified" or later (i.e. verified + approved) —
 * Country Supervisor's own ceiling in the lifecycle, and the pool
 * conversion_rate below measures against.
 */
export async function computeVerifiedCandidates(filters: KpiFilters): Promise<number> {
  const flow = await computeApplicantFlow(filters);
  return verifiedCandidatesFromFlow(flow);
}

/**
 * "Conversion rate" (redefined 2026-07-13, confirmed with the business):
 * of the candidates who made it to "verified", what fraction went all the
 * way through to "approved" — not identified→approved anymore, since a
 * huge chunk of the funnel (screening, document upload, recruiter
 * reporting) is agent-network throughput rather than something a
 * verified candidate's own approval odds should be judged against. Also
 * returns the full stage-by-stage breakdown for the funnel view, which is
 * unaffected by this redefinition. A candidate currently sitting at stage
 * N is counted as having cleared every stage before N (lifecycle stages
 * are strictly sequential — see candidateLifecycle.ts), so "reached this
 * stage or later" is just an index comparison, not a separate historical
 * query.
 */
export async function computeConversionRates(filters: KpiFilters): Promise<{ overall: number; byStage: StageConversion[] }> {
  const flow = await computeApplicantFlow(filters);
  const reachedOrLater = (idx: number) => reachedOrLaterFromFlow(flow, idx);
  const overall = conversionOverallFromFlow(flow);

  const byStage: StageConversion[] = [];
  for (let i = 0; i < LIFECYCLE_ORDER.length - 1; i++) {
    const fromCount = reachedOrLater(i);
    const toCount = reachedOrLater(i + 1);
    byStage.push({
      from: LIFECYCLE_ORDER[i],
      to: LIFECYCLE_ORDER[i + 1],
      rate: fromCount === 0 ? 0 : Math.round((toCount / fromCount) * 1000) / 10,
    });
  }

  return { overall, byStage };
}

export interface KpiSummary {
  agentSignups: number;
  recruiterResponseRate: number;
  applicantFlow: Record<CandidateLifecycleStatus, number>;
  conversion: { overall: number; byStage: StageConversion[] };
}

export async function computeKpiSummary(filters: KpiFilters): Promise<KpiSummary> {
  const [agentSignups, recruiterResponseRate, applicantFlow, conversion] = await Promise.all([
    computeAgentSignups(filters),
    computeRecruiterResponseRate(filters),
    computeApplicantFlow(filters),
    computeConversionRates(filters),
  ]);
  return { agentSignups, recruiterResponseRate, applicantFlow, conversion };
}

export interface PartnerPerformance {
  partnerId: string;
  partnerName: string;
  candidatesSourced: number;
  approved: number;
}

/**
 * Per-partner performance (SRS FR-5.1): how many candidates each agency
 * sourced in the period, and how many of those reached "approved" —
 * a genuinely partner-based metric, additive to (not replacing)
 * computeRecruiterResponseRate above.
 */
export async function computePartnerPerformance(
  filters: Pick<KpiFilters, "periodStart" | "periodEnd">
): Promise<PartnerPerformance[]> {
  const partners = await prisma.partner.findMany({
    where: { candidates: { some: { created_at: { gte: filters.periodStart, lte: filters.periodEnd } } } },
    select: {
      id: true,
      name: true,
      candidates: {
        where: { created_at: { gte: filters.periodStart, lte: filters.periodEnd } },
        select: { lifecycle_status: true },
      },
    },
    orderBy: { name: "asc" },
  });

  return partners.map((p: (typeof partners)[number]) => ({
    partnerId: p.id,
    partnerName: p.name,
    candidatesSourced: p.candidates.length,
    approved: p.candidates.filter((c: (typeof p.candidates)[number]) => c.lifecycle_status === "approved").length,
  }));
}

export interface TargetVsActual {
  campaignTargetId: string;
  metric: CampaignMetric;
  countryId: string | null;
  regionId: string | null;
  targetValue: number;
  actualValue: number;
}

/**
 * "Targets vs actuals" (SRS FR-3.2): for every CampaignTarget on a
 * campaign, compute the real current value for that same metric/scope
 * and compare. `actualValue` for "conversion_rate" is the overall
 * verified→approved rate; for "verified_candidates" it's a count.
 */
export async function computeTargetsVsActuals(campaignId: string, filters: Pick<KpiFilters, "periodStart" | "periodEnd">): Promise<TargetVsActual[]> {
  const targets = await prisma.campaignTarget.findMany({ where: { campaign_id: campaignId } });
  const getFlow = createFlowCache();

  return Promise.all(
    targets.map(async (target: CampaignTarget) => {
      const scoped: KpiFilters = {
        ...filters,
        countryId: target.country_id ?? undefined,
        regionId: target.region_id ?? undefined,
      };

      const flow = await getFlow(scoped);
      const actualValue = target.metric === "conversion_rate" ? conversionOverallFromFlow(flow) : verifiedCandidatesFromFlow(flow);

      return {
        campaignTargetId: target.id,
        metric: target.metric,
        countryId: target.country_id,
        regionId: target.region_id,
        targetValue: target.target_value,
        actualValue,
      };
    })
  );
}

export interface CountryTargetVsActual {
  campaignTargetId: string;
  metric: CampaignMetric;
  campaignName: string;
  targetValue: number;
  actualValue: number;
}

/**
 * A country's own target-vs-actual (Country Supervisor Overview) — same
 * shape as computeTargetsVsActuals but scoped directly to one country's
 * active CampaignTargets rather than one campaign's full target set, since
 * a country can sit under several concurrent campaigns.
 */
export async function computeCountryTargetsVsActuals(
  countryId: string,
  filters: Pick<KpiFilters, "periodStart" | "periodEnd">
): Promise<CountryTargetVsActual[]> {
  const targets = await prisma.campaignTarget.findMany({
    where: { country_id: countryId, campaign: { status: "active" } },
    include: { campaign: { select: { name: true } } },
  });
  const getFlow = createFlowCache();

  return Promise.all(
    targets.map(async (target: CampaignTarget & { campaign: { name: string } }) => {
      const scoped: KpiFilters = { ...filters, countryId };

      const flow = await getFlow(scoped);
      const actualValue = target.metric === "conversion_rate" ? conversionOverallFromFlow(flow) : verifiedCandidatesFromFlow(flow);

      return {
        campaignTargetId: target.id,
        metric: target.metric,
        campaignName: target.campaign.name,
        targetValue: target.target_value,
        actualValue,
      };
    })
  );
}

export interface RecruiterTargetVsActual {
  recruiterTargetId: string;
  metric: CampaignMetric;
  campaignName: string;
  targetValue: number;
  actualValue: number;
}

/**
 * A recruiter's personal target-vs-actual for a given report period —
 * "actual" is measured over the report's own date range (not the parent
 * campaign's full duration), same recruiterId-scoped KPI functions
 * already used elsewhere, just narrowed to one recruiter's allocations.
 */
export async function computeRecruiterTargetsVsActuals(
  recruiterId: string,
  filters: Pick<KpiFilters, "periodStart" | "periodEnd">
): Promise<RecruiterTargetVsActual[]> {
  const targets = await prisma.recruiterTarget.findMany({
    where: { recruiter_id: recruiterId },
    include: { campaign_target: { include: { campaign: { select: { name: true } } } } },
  });
  const getFlow = createFlowCache();

  return Promise.all(
    targets.map(async (rt: RecruiterTarget & { campaign_target: CampaignTarget & { campaign: { name: string } } }) => {
      const scoped: KpiFilters = { ...filters, recruiterId };

      const flow = await getFlow(scoped);
      const actualValue = rt.campaign_target.metric === "conversion_rate" ? conversionOverallFromFlow(flow) : verifiedCandidatesFromFlow(flow);

      return {
        recruiterTargetId: rt.id,
        metric: rt.campaign_target.metric,
        campaignName: rt.campaign_target.campaign.name,
        targetValue: rt.target_value,
        actualValue,
      };
    })
  );
}

export interface StaffKpiTargetVsActual {
  id: string;
  kpiLabel: string;
  targetValue: number;
  actualValue: number | null; // null until the staff member has a report with that label's row filled in
}

const REPORT_SCOPE_BY_ROLE: Record<string, "recruiter" | "country" | "inhouse"> = {
  regional_recruiter: "recruiter",
  country_supervisor: "country",
  inhouse_supervisor: "inhouse",
};

/**
 * A staff member's personal KPI targets (set by their direct supervisor —
 * see StaffKpiTarget in schema.prisma) against the "actual" value they
 * most recently reported for that same label. Unlike
 * computeRecruiterTargetsVsActuals, there's no live-computable formula for
 * labels like "CRM accuracy / completeness" or "On-time regional
 * reports" — actuals here are simply read off the staff member's own
 * latest (non-draft) report of that cycle, matched by label, which is
 * also what keeps this consistent with the correction that targets must
 * match what's actually in the report's own KPI table.
 */
export async function computeStaffKpiTargetsVsActuals(staffId: string, cycle: ReportCycle): Promise<StaffKpiTargetVsActual[]> {
  const staff = await prisma.user.findUnique({ where: { id: staffId }, select: { role: true } });
  const scopeLevel = staff ? REPORT_SCOPE_BY_ROLE[staff.role] : undefined;

  const [targets, latestReport] = await Promise.all([
    prisma.staffKpiTarget.findMany({ where: { staff_id: staffId, cycle }, orderBy: { kpi_label: "asc" } }),
    scopeLevel
      ? prisma.report.findFirst({
          where: { submitted_by: staffId, type: cycle, scope_level: scopeLevel, status: { not: "draft" } },
          orderBy: [{ period_end: "desc" }, { created_at: "desc" }],
          select: { content: true },
        })
      : Promise.resolve(null),
  ]);

  const kpiRows = ((latestReport?.content as { kpis?: { label?: string; actual?: number }[] } | null)?.kpis ?? []) as { label?: string; actual?: number }[];
  const actualsByLabel = new Map<string, number>();
  for (const row of kpiRows) {
    if (row.label && typeof row.actual === "number") actualsByLabel.set(row.label, row.actual);
  }

  return targets.map((t: (typeof targets)[number]) => ({
    id: t.id,
    kpiLabel: t.kpi_label,
    targetValue: t.target_value,
    actualValue: actualsByLabel.get(t.kpi_label) ?? null,
  }));
}

export interface CaseStageBreakdown {
  stage: string;
  count: number;
}

/**
 * How many cases currently sit in each of the 11 mobility-lifecycle
 * stages, scoped by country/region — the Director/Management dashboard's
 * operational-reality widget for the domain case ownership narrowed to
 * exclusively (2026-07). Country/region-scoped only (no period filter):
 * a case's own current stage is a live, standing state, not something
 * that happened "within" a date range.
 */
export async function computeCaseStageBreakdown(filters: Pick<KpiFilters, "countryId" | "regionId">): Promise<CaseStageBreakdown[]> {
  const countryFilter = filters.countryId
    ? { in: Array.isArray(filters.countryId) ? filters.countryId : [filters.countryId] }
    : undefined;

  const rows = await prisma.case.groupBy({
    by: ["current_stage"],
    where: {
      application: {
        candidate: {
          ...(countryFilter ? { country_id: countryFilter } : {}),
          ...(filters.regionId ? { country: { region_id: filters.regionId } } : {}),
        },
      },
    },
    _count: { _all: true },
  });

  return rows.map((r: (typeof rows)[number]) => ({ stage: r.current_stage, count: r._count?._all ?? 0 }));
}
