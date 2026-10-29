import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { getReportScopeFilter } from "@/server/services/reportWorkflow";
import type { Prisma } from "@prisma/client";

const STAFF_ROLES = ["regional_recruiter", "country_supervisor", "inhouse_supervisor", "director", "admin"] as const;
const MAX_PAGE_SIZE = 200;

// GET /api/reports — role-scoped (SRS FR-3.4, FR-3.7 escalation path):
// a recruiter sees their own; a supervisor sees their own country
// reports plus their recruiters' submissions awaiting review; in-house/
// director/admin see everything, filterable by country/type/status.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...STAFF_ROLES]);
  if (guardRes) return guardRes;

  const { searchParams } = req.nextUrl;
  const countryId = searchParams.get("country_id") ?? undefined;
  const type = searchParams.get("type") ?? undefined;
  const status = searchParams.get("status") ?? undefined;
  const recruiterId = searchParams.get("recruiter_id") ?? undefined;
  const scopeLevelParam = searchParams.get("scope_level") ?? undefined;
  const q = searchParams.get("q") ?? undefined;

  const where = await getReportScopeFilter(user!);

  const combinedWhere: Prisma.ReportWhereInput = {
    AND: [
      where,
      // An inhouse-scope report has no country_id of its own (portfolio
      // across several countries) — matching one requires checking the
      // submitter's assigned countries instead, so this needs to be an OR
      // rather than a plain equality to keep working for country_id
      // filters applied to a mix of country- and inhouse-scope reports
      // (e.g. Director's portfolio-reports table, filterable by country).
      countryId
        ? { OR: [{ country_id: countryId }, { submitter: { inhouse_country_assignments: { some: { country_id: countryId } } } }] }
        : {},
      type ? { type: type as never } : {},
      status ? { status: status as never } : {},
      recruiterId ? { submitted_by: recruiterId } : {},
      scopeLevelParam ? { scope_level: scopeLevelParam as never } : {},
      q
        ? {
            OR: [
              { submitter: { full_name: { contains: q, mode: "insensitive" } } },
              { country: { name: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {},
    ],
  };

  // Paginated, defaulting to page 1 / 50 rows even without params — a
  // director/admin's unrestricted view (or a country's accumulated
  // history over months) is otherwise a fully unbounded findMany at
  // 40-country/800-recruiter scale.
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(searchParams.get("pageSize")) || 50));

  const [reports, total] = await Promise.all([
    prisma.report.findMany({
      where: combinedWhere,
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
      orderBy: { created_at: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.report.count({ where: combinedWhere }),
  ]);

  return NextResponse.json({ data: reports, total, page, pageSize });
}

// POST /api/reports — submit a new report (SRS FR-3.4; Supervisory
// Reporting Framework §3-§5) at the caller's own scope, consolidating the
// verified child reports it names. FastAPI owns report writes since backend
// plan step 5.4 (vertex_be/app/api/v1/reports.py): it re-checks the
// session, the role, the period rules and the reporting line, audits every
// change, and vertex_web may no longer write the table. This GET stays
// here: it only reads.
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  // Must match SUBMITTERS in reports.py (tests check it).
  const guardRes = requireRole(user, ["regional_recruiter", "country_supervisor", "inhouse_supervisor"]);
  if (guardRes) return guardRes;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }
  return backendResponse(await callBackend("/api/v1/reports", { method: "POST", body }));
}
