import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { previewCountryConsolidation, previewInhouseConsolidation } from "@/server/services/reportConsolidation";
import { getInhouseAssignedCountryIds } from "@/server/scope";
import type { ReportCycle } from "@prisma/client";

// GET /api/reports/consolidation-preview?type=weekly|monthly&period_start=&period_end=
// The first step of the supervisor/in-house-initiated "Create Report"
// flow (Supervisory Reporting Framework §4.2/§4.3, §5.2/§5.3): given a
// type and an exact period, computes what a consolidated report's
// content would look like from the verified source reports for that
// period — without writing anything. The caller reviews this, fills in
// whatever manual-only fields the template needs, and submits explicitly
// via POST /api/reports.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["country_supervisor", "inhouse_supervisor", "admin"]);
  if (guardRes) return guardRes;

  const type = req.nextUrl.searchParams.get("type") as ReportCycle | null;
  const periodStart = req.nextUrl.searchParams.get("period_start");
  const periodEnd = req.nextUrl.searchParams.get("period_end");

  if (!type || type === "daily" || !periodStart || !periodEnd) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "type (weekly or monthly), period_start, and period_end are required." } },
      { status: 422 }
    );
  }

  if (user!.role === "inhouse_supervisor") {
    const countryIds = await getInhouseAssignedCountryIds(user!.userId);
    if (!countryIds.length) {
      return NextResponse.json({ error: { code: "no_country", message: "You must be assigned a country first." } }, { status: 422 });
    }
    const preview = await previewInhouseConsolidation(user!.userId, countryIds, type, new Date(periodStart), new Date(periodEnd));
    return NextResponse.json({ data: preview });
  }

  const staff = await prisma.user.findUnique({ where: { id: user!.userId }, select: { assigned_country_id: true } });
  if (!staff?.assigned_country_id) {
    return NextResponse.json({ error: { code: "no_country", message: "You must be assigned a country first." } }, { status: 422 });
  }

  const preview = await previewCountryConsolidation(staff.assigned_country_id, type, new Date(periodStart), new Date(periodEnd));
  return NextResponse.json({ data: preview });
}
