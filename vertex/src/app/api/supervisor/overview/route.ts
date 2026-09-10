import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { computeCountryTargetsVsActuals } from "@/server/services/kpi";

// GET /api/supervisor/overview?period_start=...&period_end=... — everything
// the Country Overview tab needs in one call: headcounts and pipeline size
// for the supervisor's own country, work awaiting them, and their country's
// progress against whatever campaign targets touch it — replacing the raw
// candidate list that used to live at the portal root.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["country_supervisor", "admin"]);
  if (guardRes) return guardRes;

  const periodStart = req.nextUrl.searchParams.get("period_start");
  const periodEnd = req.nextUrl.searchParams.get("period_end");
  if (!periodStart || !periodEnd) {
    return NextResponse.json({ error: { code: "validation_error", message: "period_start and period_end are required." } }, { status: 422 });
  }

  const supervisor = await prisma.user.findUnique({
    where: { id: user!.userId },
    select: { assigned_country_id: true },
  });
  if (!supervisor?.assigned_country_id) {
    return NextResponse.json({
      data: {
        countryName: null,
        recruiterCount: 0,
        candidateCount: 0,
        pendingVerificationCount: 0,
        reportsAwaitingReviewCount: 0,
        targetProgress: [],
      },
    });
  }

  const countryId = supervisor.assigned_country_id;

  const [country, recruiterCount, candidateCount, pendingVerificationCount, reportsAwaitingReviewCount, targetProgress] =
    await Promise.all([
      prisma.country.findUnique({ where: { id: countryId }, select: { name: true } }),
      prisma.user.count({ where: { role: "regional_recruiter", supervisor_id: user!.userId } }),
      prisma.candidate.count({ where: { country_id: countryId } }),
      prisma.candidate.count({ where: { country_id: countryId, lifecycle_status: "reported" } }),
      prisma.report.count({ where: { scope_level: "recruiter", country_id: countryId, status: "submitted" } }),
      computeCountryTargetsVsActuals(countryId, { periodStart: new Date(periodStart), periodEnd: new Date(periodEnd) }),
    ]);

  return NextResponse.json({
    data: {
      countryName: country?.name ?? null,
      recruiterCount,
      candidateCount,
      pendingVerificationCount,
      reportsAwaitingReviewCount,
      targetProgress,
    },
  });
}
