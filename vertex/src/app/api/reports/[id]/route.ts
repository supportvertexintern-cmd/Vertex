import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { getReportScopeFilter } from "@/server/services/reportWorkflow";

const STAFF_ROLES = ["regional_recruiter", "country_supervisor", "inhouse_supervisor", "director", "admin"] as const;

// GET /api/reports/:id — single-report detail view, same scoping as the
// paginated list (see getReportScopeFilter) so the two can never drift
// apart — powers each portal's report detail page.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...STAFF_ROLES]);
  if (guardRes) return guardRes;

  const { id } = await params;
  const scope = await getReportScopeFilter(user!);

  const report = await prisma.report.findFirst({
    where: { AND: [{ id }, scope] },
    select: {
      id: true,
      type: true,
      scope_level: true,
      status: true,
      period_start: true,
      period_end: true,
      return_reason: true,
      content: true,
      submitter: { select: { id: true, full_name: true } },
      country: { select: { id: true, name: true } },
      parent_report_id: true,
      child_reports: { select: { id: true, status: true, submitter: { select: { full_name: true } } } },
      created_at: true,
    },
  });

  if (!report) {
    return NextResponse.json({ error: { code: "not_found", message: "Report not found." } }, { status: 404 });
  }

  return NextResponse.json({ data: report });
}
