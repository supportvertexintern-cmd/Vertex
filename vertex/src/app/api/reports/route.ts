import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { submitReportSchema } from "@/lib/validations";
import { getReportScopeFilter } from "@/server/services/reportWorkflow";
import { getInhouseAssignedCountryIds } from "@/server/scope";
import type { Prisma, ScopeLevel } from "@prisma/client";

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
// Reporting Framework §3-§5). A recruiter submits at their own scope; a
// country_supervisor consolidates verified recruiter reports
// (child_report_ids) into a country report; an inhouse_supervisor
// consolidates their (single-country, per the existing confirmed
// portfolio-of-one scoping) verified country report into their own
// portfolio report, submitted upward to Management/Director.
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["regional_recruiter", "country_supervisor", "inhouse_supervisor"]);
  if (guardRes) return guardRes;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }

  const parsed = submitReportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Validation failed", details: parsed.error.flatten().fieldErrors } },
      { status: 422 }
    );
  }

  const scopeLevel: ScopeLevel =
    user!.role === "regional_recruiter" ? "recruiter" : user!.role === "country_supervisor" ? "country" : "inhouse";

  // In-House can be assigned several countries (2026-07) — their own
  // country_id is null (a portfolio roll-up, see below), so their
  // eligibility check is "assigned to at least one country", not a
  // single scalar FK the way recruiter/country_supervisor still are.
  let submitterCountryId: string | null = null;
  let inhouseCountryIds: string[] = [];
  if (scopeLevel === "inhouse") {
    inhouseCountryIds = await getInhouseAssignedCountryIds(user!.userId);
    if (!inhouseCountryIds.length) {
      return NextResponse.json({ error: { code: "no_country", message: "You must be assigned a country before submitting a report." } }, { status: 422 });
    }
  } else {
    const submitter = await prisma.user.findUnique({ where: { id: user!.userId }, select: { assigned_country_id: true } });
    if (!submitter?.assigned_country_id) {
      return NextResponse.json({ error: { code: "no_country", message: "You must be assigned a country before submitting a report." } }, { status: 422 });
    }
    submitterCountryId = submitter.assigned_country_id;
  }

  const { period_start, period_end, child_report_ids, ...rest } = parsed.data;

  if (scopeLevel === "recruiter" && child_report_ids?.length) {
    return NextResponse.json(
      { error: { code: "invalid_scope", message: "Only a country-level or portfolio-level report can consolidate child reports." } },
      { status: 422 }
    );
  }

  // A country-scope report consolidates verified recruiter reports from
  // the same country; a portfolio-scope (inhouse) report consolidates
  // verified country reports from any of the submitter's assigned
  // countries (a combined, multi-country portfolio, confirmed with the
  // business — no longer portfolio-of-one).
  const childScopeLevel: ScopeLevel = scopeLevel === "country" ? "recruiter" : "country";

  let childReports: { id: string }[] = [];
  if (child_report_ids?.length) {
    childReports = await prisma.report.findMany({
      where: {
        id: { in: child_report_ids },
        scope_level: childScopeLevel,
        status: "verified",
        country_id: scopeLevel === "inhouse" ? { in: inhouseCountryIds } : submitterCountryId,
      },
      select: { id: true },
    });
    if (childReports.length !== child_report_ids.length) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_children",
            message:
              scopeLevel === "inhouse"
                ? "Every consolidated report must be a verified report from one of your assigned countries."
                : "Every consolidated report must be a verified report from your own country.",
          },
        },
        { status: 422 }
      );
    }
  }

  const db = auditedPrisma(user!.userId);

  // An inhouse-scope report has no single country of its own (it's a
  // portfolio roll-up, addressed to Management/Director) — country_id
  // stays null for it, same nullability already used for preferred-
  // country/current-location fields elsewhere in this schema.
  const report = await db.report.create({
    data: {
      ...rest,
      scope_level: scopeLevel,
      country_id: scopeLevel === "inhouse" ? null : submitterCountryId,
      submitted_by: user!.userId,
      period_start: new Date(period_start),
      period_end: new Date(period_end),
      status: "submitted",
    },
    select: { id: true, type: true, scope_level: true, status: true, content: true },
  });

  // "CRM Submission Ref." (§2.1's report-identification section) is the
  // report's own id — there's no meaningful value for it until the row
  // exists, so it's never user-entered; fill it in immediately after
  // creation rather than asking the submitter to type anything.
  await prisma.report.update({
    where: { id: report.id },
    data: { content: { ...(report.content as object), crm_reference: report.id } },
  });

  if (childReports.length > 0) {
    await prisma.report.updateMany({
      where: { id: { in: childReports.map((c) => c.id) } },
      data: { parent_report_id: report.id, status: "consolidated" },
    });
  }

  return NextResponse.json({ data: { id: report.id, type: report.type, scope_level: report.scope_level, status: report.status } }, { status: 201 });
}
