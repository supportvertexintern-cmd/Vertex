import { prisma } from "@/lib/prisma";
import type { JwtPayload } from "@/lib/jwt";
import type { Prisma, Role, ScopeLevel } from "@prisma/client";
import { getInhouseAssignedCountryIds } from "@/server/scope";

/**
 * "One defined controlling position and approval point per process" (SRS
 * FR-3.5): a recruiter-scope report has exactly one reviewer role (the
 * country supervisor); a country-scope report has exactly one reviewer
 * role (in-house supervisor — director is deliberately **not** a fallback
 * reviewer here, confirmed with the business 2026-07-25: Director/
 * Management only ever sees actual report content for the inhouse tier,
 * everything below that is In-House's exclusive responsibility). An
 * inhouse-scope report (a portfolio report submitted upward — Supervisory
 * Reporting Framework §5) is reviewed by Management/Director, the top of
 * the reporting line. Admin is the universal override, matching every
 * other role-gated workflow in this codebase.
 */
export function canReviewReport(role: Role, scopeLevel: ScopeLevel): boolean {
  if (role === "admin") return true;
  if (scopeLevel === "recruiter") return role === "country_supervisor";
  if (scopeLevel === "country") return role === "inhouse_supervisor";
  if (scopeLevel === "inhouse") return role === "director";
  return false;
}

/** Who may create/submit a new report at a given scope (SRS FR-3.4). */
export function canSubmitReport(role: Role, scopeLevel: ScopeLevel): boolean {
  if (role === "admin") return true;
  if (scopeLevel === "recruiter") return role === "regional_recruiter";
  if (scopeLevel === "country") return role === "country_supervisor";
  if (scopeLevel === "inhouse") return role === "inhouse_supervisor";
  return false;
}

/**
 * Row-level scoping for /api/reports (SRS FR-3.4, FR-3.7), shared between
 * the paginated list and the single-report detail lookup so the two
 * views can never drift apart — a recruiter sees only their own; a
 * country_supervisor sees their own country's recruiter reports plus
 * their own; an inhouse_supervisor sees their own country's reports plus
 * their own portfolio-level (inhouse-scope) reports, which have no
 * single country_id of their own; admin is unrestricted. Director is
 * scoped to inhouse-scope reports only (2026-07-25, confirmed with the
 * business) — actual report content below that tier is In-House's
 * exclusive concern; Director's visibility into recruiter/country
 * reporting is aggregate metrics only (see /api/management/report-metrics),
 * never the report content itself.
 */
export async function getReportScopeFilter(user: JwtPayload): Promise<Prisma.ReportWhereInput> {
  switch (user.role) {
    case "regional_recruiter":
      return { submitted_by: user.userId };

    case "country_supervisor": {
      const supervisor = await prisma.user.findUnique({ where: { id: user.userId }, select: { assigned_country_id: true } });
      if (!supervisor?.assigned_country_id) return { id: "__none__" };
      return { OR: [{ submitted_by: user.userId }, { scope_level: "recruiter", country_id: supervisor.assigned_country_id }] };
    }

    case "inhouse_supervisor": {
      const countryIds = await getInhouseAssignedCountryIds(user.userId);
      if (!countryIds.length) return { submitted_by: user.userId };
      return { OR: [{ country_id: { in: countryIds } }, { submitted_by: user.userId }] };
    }

    case "director":
      return { scope_level: "inhouse" };

    default:
      return {}; // admin — unrestricted
  }
}
