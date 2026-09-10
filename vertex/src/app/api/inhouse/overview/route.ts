import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { computeApplicantFlow, computeVerifiedCandidates, computeConversionRates } from "@/server/services/kpi";
import { getInhouseAssignedCountryIds } from "@/server/scope";

// GET /api/inhouse/overview — everything the In-House Supervisor's
// Country Overview dashboard needs, pre-scoped server-side to their
// assigned countries (2026-07: can be more than one — same fail-closed
// posture as scope.ts) rather than trusting a client-supplied country_id.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["inhouse_supervisor", "admin"]);
  if (guardRes) return guardRes;

  const countryIds = await getInhouseAssignedCountryIds(user!.userId);
  if (!countryIds.length) {
    return NextResponse.json({ error: { code: "no_country", message: "You are not yet assigned a country." } }, { status: 422 });
  }

  const countries = await prisma.country.findMany({
    where: { id: { in: countryIds } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const [recruiters, candidateFunnel, pendingCountryReports, activeCampaignTargets, countrySupervisors] = await Promise.all([
    prisma.user.findMany({
      where: { role: "regional_recruiter", assigned_country_id: { in: countryIds } },
      select: { id: true, full_name: true },
      orderBy: { full_name: "asc" },
    }),
    computeApplicantFlow({ countryId: countryIds, periodStart: new Date(0), periodEnd: new Date() }),
    prisma.report.count({ where: { scope_level: "country", country_id: { in: countryIds }, status: "submitted" } }),
    prisma.campaignTarget.findMany({
      where: { country_id: { in: countryIds }, campaign: { status: "active" } },
      select: {
        id: true,
        metric: true,
        target_value: true,
        country_id: true,
        country: { select: { id: true, name: true } },
        campaign: { select: { id: true, name: true } },
      },
      orderBy: { created_at: "desc" },
    }),
    // For the Supervisory Performance Scorecard panel (§7) — every
    // Country Supervisor across the In-House Supervisor's assigned
    // countries, one scorecard panel each (was a single findFirst under
    // the old confirmed single-country scoping).
    prisma.user.findMany({
      where: { role: "country_supervisor", assigned_country_id: { in: countryIds } },
      select: { id: true, full_name: true, assigned_country: { select: { id: true, name: true } } },
      orderBy: { full_name: "asc" },
    }),
  ]);

  // Which recruiters have a "daily" report covering today, for the
  // compliance readout — a plain overlap check on period_end rather than
  // assuming an exact date match, since a daily report's own period_start/
  // period_end shape is the recruiter-reports feature's concern, not this
  // dashboard's.
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  const todaysDailyReports = await prisma.report.findMany({
    where: {
      type: "daily",
      scope_level: "recruiter",
      country_id: { in: countryIds },
      period_end: { gte: startOfToday, lte: endOfToday },
    },
    select: { submitted_by: true },
  });
  const submittedTodayIds = new Set(todaysDailyReports.map((r: (typeof todaysDailyReports)[number]) => r.submitted_by));

  // Each target's "actual" is scoped to its own single country, not
  // aggregated across every assigned country — a target is always a
  // per-country number (CampaignTarget.country_id), so its progress must
  // be measured against that same one country.
  const campaignTargets = await Promise.all(
    activeCampaignTargets.map(async (t: (typeof activeCampaignTargets)[number]) => {
      const scoped = { countryId: t.country_id ?? undefined, periodStart: new Date(0), periodEnd: new Date() };
      const actualValue =
        t.metric === "conversion_rate" ? (await computeConversionRates(scoped)).overall : await computeVerifiedCandidates(scoped);
      return {
        id: t.id,
        metric: t.metric,
        targetValue: t.target_value,
        actualValue,
        campaignName: t.campaign.name,
        country: t.country,
      };
    })
  );

  return NextResponse.json({
    data: {
      countries,
      recruiterCount: recruiters.length,
      dailyCompliance: {
        submitted: recruiters.filter((r: (typeof recruiters)[number]) => submittedTodayIds.has(r.id)).length,
        total: recruiters.length,
        recruiters: recruiters.map((r: (typeof recruiters)[number]) => ({ id: r.id, full_name: r.full_name, submittedToday: submittedTodayIds.has(r.id) })),
      },
      candidateFunnel,
      pendingCountryReports,
      campaignTargets,
      countrySupervisors,
    },
  });
}
