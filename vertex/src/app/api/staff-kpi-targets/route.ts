import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { upsertStaffKpiTargetSchema } from "@/lib/validations";
import { computeStaffKpiTargetsVsActuals } from "@/server/services/kpi";
import { getInhouseAssignedCountryIds } from "@/server/scope";
import { REPORT_KPI_LABELS } from "@/lib/reportTemplates";
import { STAFF_ROLES } from "@/lib/rbac";
import type { JwtPayload } from "@/lib/jwt";
import type { ReportCycle, Role } from "@prisma/client";

interface TargetStaff {
  id: string;
  role: Role;
  supervisor_id: string | null;
  assigned_country_id: string | null;
}

// One shared mechanism for all 3 supervisory relationships (country
// supervisor -> recruiter, in-house -> country supervisor, director ->
// in-house) — who may set a target for a given recipient depends entirely
// on the recipient's own role/reporting line, not on a fixed role pair.
async function callerCanManage(caller: JwtPayload, staff: TargetStaff): Promise<boolean> {
  if (caller.role === "admin") return true;

  if (staff.role === "regional_recruiter") {
    return caller.role === "country_supervisor" && staff.supervisor_id === caller.userId;
  }
  if (staff.role === "country_supervisor") {
    if (caller.role !== "inhouse_supervisor" || !staff.assigned_country_id) return false;
    const countryIds = await getInhouseAssignedCountryIds(caller.userId);
    return countryIds.includes(staff.assigned_country_id);
  }
  if (staff.role === "inhouse_supervisor") {
    return caller.role === "director";
  }
  return false;
}

// GET /api/staff-kpi-targets?staff_id=&cycle= — a staff member's own
// targets-vs-actuals for one cycle (id/kpiLabel/targetValue/actualValue,
// see computeStaffKpiTargetsVsActuals), readable by the staff member
// themselves or whoever manages their targets. staff_id defaults to the
// caller's own id (same "mine" convention as /api/campaigns?scope=mine)
// so a report-creation form can pre-fill its own KPI targets without
// needing to already know its own user id.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, STAFF_ROLES);
  if (guardRes) return guardRes;

  const staffId = req.nextUrl.searchParams.get("staff_id") ?? user!.userId;
  const cycle = req.nextUrl.searchParams.get("cycle") as ReportCycle | null;
  if (!cycle) {
    return NextResponse.json({ error: { code: "validation_error", message: "cycle is required." } }, { status: 422 });
  }

  const staff = await prisma.user.findUnique({
    where: { id: staffId },
    select: { id: true, role: true, supervisor_id: true, assigned_country_id: true },
  });
  if (!staff) return NextResponse.json({ error: { code: "not_found", message: "Staff member not found." } }, { status: 404 });

  const allowed = user!.userId === staffId || (await callerCanManage(user!, staff));
  if (!allowed) return NextResponse.json({ error: { code: "forbidden", message: "Forbidden." } }, { status: 403 });

  const data = await computeStaffKpiTargetsVsActuals(staffId, cycle);
  return NextResponse.json({ data });
}

// POST /api/staff-kpi-targets — upsert one KPI-row target for a direct
// report, keyed to the exact label their own report's KPI table already
// uses for that cycle (REPORT_KPI_LABELS) — not a generic campaign metric.
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, STAFF_ROLES);
  if (guardRes) return guardRes;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }

  const parsed = upsertStaffKpiTargetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Validation failed", details: parsed.error.flatten().fieldErrors } },
      { status: 422 }
    );
  }

  const { staff_id, cycle, kpi_label, target_value } = parsed.data;

  const staff: TargetStaff | null = await prisma.user.findUnique({
    where: { id: staff_id },
    select: { id: true, role: true, supervisor_id: true, assigned_country_id: true },
  });
  if (!staff) return NextResponse.json({ error: { code: "not_found", message: "Staff member not found." } }, { status: 404 });

  const validLabels = REPORT_KPI_LABELS[staff.role]?.[cycle] ?? [];
  if (!validLabels.includes(kpi_label)) {
    return NextResponse.json(
      { error: { code: "invalid_label", message: "That label doesn't appear on this staff member's report for this cycle." } },
      { status: 422 }
    );
  }

  if (!(await callerCanManage(user!, staff))) {
    return NextResponse.json({ error: { code: "forbidden", message: "You can only set targets for your own direct reports." } }, { status: 403 });
  }

  const db = auditedPrisma(user!.userId);
  const target = await db.staffKpiTarget.upsert({
    where: { staff_id_cycle_kpi_label: { staff_id, cycle, kpi_label } },
    update: { target_value, set_by: user!.userId },
    create: { staff_id, cycle, kpi_label, target_value, set_by: user!.userId },
    select: { id: true, staff_id: true, cycle: true, kpi_label: true, target_value: true, updated_at: true },
  });

  return NextResponse.json({ data: target }, { status: 201 });
}
