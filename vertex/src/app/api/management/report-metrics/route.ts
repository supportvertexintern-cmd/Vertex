import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import type { ReportCycle } from "@prisma/client";

const MAX_PAGE_SIZE = 100;

// GET /api/management/report-metrics?cadence=&country_id=&q=&page=&pageSize=
// Director/Management's visibility into recruiter and country-supervisor
// reporting is aggregate metrics only — submission counts by status and
// last-submission date, never the report content itself. Actual report
// content below the in-house tier stays In-House's exclusive review
// responsibility (2026-07-25, confirmed with the business — see
// reportWorkflow.ts's getReportScopeFilter, whose director branch now
// only returns scope_level "inhouse" reports).
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["director", "admin"]);
  if (guardRes) return guardRes;

  const { searchParams } = req.nextUrl;
  const cadence = (searchParams.get("cadence") as ReportCycle | null) ?? "weekly";
  const countryId = searchParams.get("country_id") ?? undefined;
  const q = searchParams.get("q") ?? undefined;
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(searchParams.get("pageSize")) || 15));

  const where = {
    role: { in: ["regional_recruiter" as const, "country_supervisor" as const] },
    ...(countryId ? { assigned_country_id: countryId } : {}),
    ...(q ? { full_name: { contains: q, mode: "insensitive" as const } } : {}),
  };

  const [staff, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        full_name: true,
        role: true,
        assigned_country: { select: { id: true, name: true } },
        submitted_reports: {
          where: { type: cadence },
          select: { status: true, period_end: true },
        },
      },
      orderBy: { full_name: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.user.count({ where }),
  ]);

  const data = staff.map((s: (typeof staff)[number]) => {
    const reports: (typeof s)["submitted_reports"] = s.submitted_reports;
    let lastReportAt: Date | null = null;
    for (const r of reports) {
      if (!lastReportAt || r.period_end > lastReportAt) lastReportAt = r.period_end;
    }
    return {
      id: s.id,
      full_name: s.full_name,
      role: s.role,
      country: s.assigned_country,
      submittedCount: reports.length,
      verifiedCount: reports.filter((r: (typeof reports)[number]) => r.status === "verified" || r.status === "approved" || r.status === "consolidated").length,
      returnedCount: reports.filter((r: (typeof reports)[number]) => r.status === "returned").length,
      lastReportAt,
    };
  });

  return NextResponse.json({ data, total, page, pageSize });
}
