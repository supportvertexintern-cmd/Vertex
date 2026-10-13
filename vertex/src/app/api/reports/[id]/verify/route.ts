import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { getAuthUser, requireRole, forbidden } from "@/lib/api-auth";
import { canReviewReport } from "@/server/services/reportWorkflow";
import { getInhouseAssignedCountryIds } from "@/server/scope";

const REVIEWER_ROLES = ["country_supervisor", "inhouse_supervisor", "director", "admin"] as const;

// PATCH /api/reports/:id/verify — the report's one controlling position
// (SRS FR-3.5) approves it as submitted, no changes needed.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...REVIEWER_ROLES]);
  if (guardRes) return guardRes;

  const { id } = await params;

  const report = await prisma.report.findUnique({ where: { id } });
  if (!report) {
    return NextResponse.json({ error: { code: "not_found", message: "Report not found." } }, { status: 404 });
  }

  if (!canReviewReport(user!.role, report.scope_level)) {
    return forbidden({ error: { code: "forbidden", message: "You are not the controlling position for this report." } });
  }

  if (report.scope_level === "recruiter" && user!.role === "country_supervisor") {
    const supervisor = await prisma.user.findUnique({ where: { id: user!.userId }, select: { assigned_country_id: true } });
    if (supervisor?.assigned_country_id !== report.country_id) {
      return forbidden({ error: { code: "forbidden", message: "This report is not in your assigned country." } });
    }
  }

  // Mirrors the check above for the country-scope report's own reviewer:
  // an In-House Supervisor is assigned to one or more countries, so
  // canReviewReport() alone (which only checks the role) isn't enough —
  // director/admin remain unrestricted.
  if (report.scope_level === "country" && user!.role === "inhouse_supervisor") {
    const countryIds = await getInhouseAssignedCountryIds(user!.userId);
    if (!report.country_id || !countryIds.includes(report.country_id)) {
      return forbidden({ error: { code: "forbidden", message: "This report is not in one of your assigned countries." } });
    }
  }

  if (report.status !== "submitted") {
    return NextResponse.json({ error: { code: "invalid_transition", message: `A report in '${report.status}' status cannot be verified.` } }, { status: 422 });
  }

  // Country Supervisor "verifies"; Management/Director "approves" — same
  // action (the report's one controlling position accepting it as
  // submitted), different terminal status per the framework's own
  // vocabulary (§8.2) for the top of the reporting line. Verifying a
  // recruiter/country report no longer auto-creates and auto-submits the
  // parent (country/portfolio) report — the supervisor/in-house initiates
  // that themselves via the "Create Report" flow, which previews the
  // same computed roll-up but always requires an explicit review and
  // Certify & Submit (confirmed with the business: several fields in the
  // weekly/monthly templates need manual input, and a silent auto-submit
  // gave no chance to fill those in or catch a mistake before it went out).
  const updated = await auditedPrisma(user!.userId).report.update({
    where: { id },
    data: { status: report.scope_level === "inhouse" ? "approved" : "verified", return_reason: null },
    select: { id: true, status: true },
  });

  return NextResponse.json({ data: updated });
}
