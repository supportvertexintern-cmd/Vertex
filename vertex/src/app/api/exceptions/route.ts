import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { passOn, readJson } from "@/lib/pipeline";
import { getInhouseAssignedCountryIds } from "@/server/scope";
import type { Prisma, Role } from "@prisma/client";

const STAFF_ROLES: Role[] = ["regional_recruiter", "country_supervisor", "inhouse_supervisor", "director", "admin"];
const MAX_PAGE_SIZE = 100;

// GET /api/exceptions — role-scoped, same shape as /api/reports: a
// recruiter sees their own; a country/in-house supervisor sees their own
// plus their country's; director/admin see everything.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, STAFF_ROLES);
  if (guardRes) return guardRes;

  const { searchParams } = req.nextUrl;
  const status = searchParams.get("status") ?? undefined;
  const escalationLevel = searchParams.get("escalation_level") ?? undefined;
  // Search + category filter (Portal Improvement Requirements item 3,
  // 2026-08-18) — matches the reference/issue text or the raising
  // candidate's name, same "search across the record's own identifying
  // fields" pattern every other list endpoint uses.
  const category = searchParams.get("category") ?? undefined;
  const q = searchParams.get("q")?.trim() || undefined;

  let where: Prisma.ExceptionWhereInput;
  switch (user!.role) {
    case "regional_recruiter":
      where = { raised_by: user!.userId };
      break;
    case "country_supervisor": {
      const staff = await prisma.user.findUnique({ where: { id: user!.userId }, select: { assigned_country_id: true } });
      where = staff?.assigned_country_id
        ? { OR: [{ raised_by: user!.userId }, { country_id: staff.assigned_country_id }] }
        : { raised_by: user!.userId };
      break;
    }
    case "inhouse_supervisor": {
      const countryIds = await getInhouseAssignedCountryIds(user!.userId);
      where = countryIds.length
        ? { OR: [{ raised_by: user!.userId }, { country_id: { in: countryIds } }] }
        : { raised_by: user!.userId };
      break;
    }
    default:
      where = {}; // director, admin — unrestricted
  }

  const combinedWhere: Prisma.ExceptionWhereInput = {
    AND: [
      where,
      status ? { status: status as never } : {},
      escalationLevel ? { escalation_level: escalationLevel as never } : {},
      category ? { category: category as never } : {},
      q
        ? {
            OR: [
              { reference: { contains: q, mode: "insensitive" } },
              { issue_statement: { contains: q, mode: "insensitive" } },
              { candidate: { full_name: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {},
    ],
  };

  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(searchParams.get("pageSize")) || 15));

  const [data, total] = await Promise.all([
    prisma.exception.findMany({
      where: combinedWhere,
      select: {
        id: true,
        reference: true,
        category: true,
        raiser: { select: { id: true, full_name: true, role: true } },
        role_at_raise: true,
        country: { select: { id: true, name: true } },
        candidate: { select: { id: true, full_name: true } },
        reference_note: true,
        issue_statement: true,
        immediate_impact: true,
        decision_required: true,
        decision_deadline: true,
        escalation_level: true,
        status: true,
        decision: true,
        decision_notes: true,
        decider: { select: { id: true, full_name: true } },
        decided_at: true,
        created_at: true,
        corrective_actions: {
          select: { id: true, action: true, owner: { select: { id: true, full_name: true } }, due_date: true, success_measure: true, status: true, evidence: true },
        },
      },
      orderBy: { created_at: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.exception.count({ where: combinedWhere }),
  ]);

  return NextResponse.json({ data, total, page, pageSize });
}

// POST /api/exceptions — raise an exception (Supervisory Reporting
// Framework §6), any staff role, at any time. Written by FastAPI since the
// pipeline switch (step 6.7; vertex_be/app/api/v1/exceptions.py): the
// starting tier by role, the sequential reference, the corrective actions.
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, STAFF_ROLES);
  if (guardRes) return guardRes;
  const read = await readJson(req);
  if (read.invalid) return read.invalid;
  return passOn("/api/v1/exceptions", { method: "POST", body: read.body });
}
