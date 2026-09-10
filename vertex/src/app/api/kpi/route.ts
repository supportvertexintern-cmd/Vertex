import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { computeKpiSummary, computeTargetsVsActuals, computePartnerPerformance, computeCaseStageBreakdown, type KpiFilters } from "@/server/services/kpi";
import { getInhouseAssignedCountryIds } from "@/server/scope";

// GET /api/kpi — Management/Control dashboard data (SRS FR-3.1, FR-3.2,
// FR-3.8). Restricted to the roles the dashboard itself is for — a
// recruiter/supervisor already has their own scoped views on
// /recruiter and /supervisor.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["inhouse_supervisor", "director", "admin"]);
  if (guardRes) return guardRes;

  const { searchParams } = req.nextUrl;
  const periodStartParam = searchParams.get("period_start");
  const periodEndParam = searchParams.get("period_end");

  // Default window: last 90 days, if the caller doesn't specify one.
  const periodEnd = periodEndParam ? new Date(periodEndParam) : new Date();
  const periodStart = periodStartParam ? new Date(periodStartParam) : new Date(periodEnd.getTime() - 90 * 24 * 60 * 60 * 1000);

  // In-House Supervisor's own assigned countries win regardless of what a
  // client passes, the same fail-closed posture as scope.ts. Director/admin
  // remain unrestricted.
  let countryId: string | string[] | undefined = searchParams.get("country_id") ?? undefined;
  let regionId = searchParams.get("region_id") ?? undefined;
  if (user!.role === "inhouse_supervisor") {
    const countryIds = await getInhouseAssignedCountryIds(user!.userId);
    countryId = countryIds.length ? countryIds : "__none__";
    regionId = undefined;
  }

  const filters: KpiFilters = {
    periodStart,
    periodEnd,
    countryId,
    regionId,
    recruiterId: searchParams.get("recruiter_id") ?? undefined,
  };

  const campaignId = searchParams.get("campaign_id");

  const [summary, targetsVsActuals, partnerPerformance, caseStageBreakdown] = await Promise.all([
    computeKpiSummary(filters),
    campaignId ? computeTargetsVsActuals(campaignId, filters) : Promise.resolve(null),
    computePartnerPerformance(filters),
    computeCaseStageBreakdown(filters),
  ]);

  return NextResponse.json({ data: { summary, targetsVsActuals, partnerPerformance, caseStageBreakdown } });
}
