import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { getAuthUser, requireRole, forbidden } from "@/lib/api-auth";
import { canReviewReport } from "@/server/services/reportWorkflow";
import { returnReportSchema } from "@/lib/validations";
import { getInhouseAssignedCountryIds } from "@/server/scope";

const REVIEWER_ROLES = ["country_supervisor", "inhouse_supervisor", "director", "admin"] as const;

// PATCH /api/reports/:id/return — the controlling position sends an
// incomplete/incorrect report back to its submitter with a reason (SRS
// FR-3.5, mirroring the candidate-return workflow from Phase 2).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...REVIEWER_ROLES]);
  if (guardRes) return guardRes;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }

  const parsed = returnReportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Validation failed", details: parsed.error.flatten().fieldErrors } },
      { status: 422 }
    );
  }

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

  if (report.scope_level === "country" && user!.role === "inhouse_supervisor") {
    const countryIds = await getInhouseAssignedCountryIds(user!.userId);
    if (!report.country_id || !countryIds.includes(report.country_id)) {
      return forbidden({ error: { code: "forbidden", message: "This report is not in one of your assigned countries." } });
    }
  }

  if (report.status !== "submitted") {
    return NextResponse.json({ error: { code: "invalid_transition", message: `A report in '${report.status}' status cannot be returned.` } }, { status: 422 });
  }

  const updated = await auditedPrisma(user!.userId).report.update({
    where: { id },
    data: { status: "returned", return_reason: parsed.data.return_reason },
    select: { id: true, status: true, return_reason: true },
  });

  return NextResponse.json({ data: updated });
}
