import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { upsertStaffScorecardSchema, SCORECARD_AREAS } from "@/lib/validations";
import type { Prisma, Role } from "@prisma/client";

const REVIEWER_ROLES: Role[] = ["country_supervisor", "inhouse_supervisor", "director", "admin"];

// GET /api/staff-scorecards — a staff member sees their own (read-only);
// a reviewer sees the ones they've authored; director/admin see everything.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["regional_recruiter", "country_supervisor", "inhouse_supervisor", "director", "admin"]);
  if (guardRes) return guardRes;

  const staffId = req.nextUrl.searchParams.get("staff_id") ?? undefined;

  let where: Prisma.StaffScorecardWhereInput;
  if (user!.role === "director" || user!.role === "admin") {
    where = {};
  } else {
    where = { OR: [{ staff_id: user!.userId }, { reviewer_id: user!.userId }] };
  }
  const combinedWhere: Prisma.StaffScorecardWhereInput = { AND: [where, staffId ? { staff_id: staffId } : {}] };

  const data = await prisma.staffScorecard.findMany({
    where: combinedWhere,
    select: {
      id: true,
      staff: { select: { id: true, full_name: true, role: true } },
      reviewer: { select: { id: true, full_name: true } },
      period_month: true,
      status: true,
      overall_score: true,
      performance_category: true,
      required_action: true,
      review_date: true,
      areas: { select: { id: true, area_key: true, weight: true, rating: true, evidence: true } },
      created_at: true,
    },
    orderBy: { period_month: "desc" },
  });

  return NextResponse.json({ data });
}

// POST /api/staff-scorecards — create or update a draft monthly scorecard
// for a direct report (Supervisory Reporting Framework §7). Only the
// staff member's own supervisor (User.supervisor_id) may author one for
// them — never self-submitted.
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, REVIEWER_ROLES);
  if (guardRes) return guardRes;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }

  const parsed = upsertStaffScorecardSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Validation failed", details: parsed.error.flatten().fieldErrors } },
      { status: 422 }
    );
  }

  const staff = await prisma.user.findUnique({ where: { id: parsed.data.staff_id }, select: { supervisor_id: true } });
  if (!staff) return NextResponse.json({ error: { code: "not_found", message: "Staff member not found." } }, { status: 404 });
  if (user!.role !== "admin" && staff.supervisor_id !== user!.userId) {
    return NextResponse.json({ error: { code: "forbidden", message: "You can only score your own direct reports." } }, { status: 403 });
  }

  const db = auditedPrisma(user!.userId);
  const periodMonth = new Date(parsed.data.period_month);

  const scorecard = await db.staffScorecard.upsert({
    where: { staff_id_period_month: { staff_id: parsed.data.staff_id, period_month: periodMonth } },
    update: {},
    create: {
      staff_id: parsed.data.staff_id,
      reviewer_id: user!.userId,
      period_month: periodMonth,
    },
    select: { id: true, status: true },
  });

  if (scorecard.status !== "draft") {
    return NextResponse.json({ error: { code: "already_finalized", message: "This scorecard has already been finalized." } }, { status: 422 });
  }

  await Promise.all(
    SCORECARD_AREAS.map((area) => {
      const submitted = parsed.data.areas.find((a) => a.area_key === area.key);
      return prisma.staffScorecardArea.upsert({
        where: { scorecard_id_area_key: { scorecard_id: scorecard.id, area_key: area.key } },
        update: { rating: submitted?.rating, evidence: submitted?.evidence },
        create: { scorecard_id: scorecard.id, area_key: area.key, weight: area.weight, rating: submitted?.rating, evidence: submitted?.evidence },
      });
    })
  );

  const full = await prisma.staffScorecard.findUnique({
    where: { id: scorecard.id },
    select: { id: true, status: true, areas: { select: { area_key: true, weight: true, rating: true, evidence: true } } },
  });

  return NextResponse.json({ data: full }, { status: 201 });
}
