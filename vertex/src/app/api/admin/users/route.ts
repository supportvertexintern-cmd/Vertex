import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireAdmin, requireRole } from "@/lib/api-auth";
import type { Role } from "@prisma/client";
import { callBackend } from "@/lib/backend";
import { pipelineResponse } from "@/lib/pipeline";
import { alertOnPrivilegeGranted } from "@/lib/auth-backend";

const STAFF_ROLES: Role[] = [
  "regional_recruiter",
  "country_supervisor",
  "inhouse_supervisor",
  "director",
  "marketing",
  "hr",
  "operations_team",
  "operations_director",
  "finance",
  "admin",
];

// GET /api/admin/users?role=&q= — staff directory for role/supervisor/country
// assignment (SRS FR-1.1, FR-1.3, FR-1.4). With no query, defaults to staff
// roles only; a text search (q) searches every user, including candidates,
// so an admin can find and promote one into the agent network. An explicit
// role param always narrows to that role regardless of q.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  // Read-only staff directory access is also needed by Management/Director
  // for the Supervisory Performance Scorecard (§7) — director scores an
  // In-House Supervisor, which needs the staff list to pick from. Staff
  // creation/editing below stays admin-only.
  const guardRes = requireRole(user, ["admin", "director"]);
  if (guardRes) return guardRes;

  const roleParam = req.nextUrl.searchParams.get("role") as Role | null;
  const q = req.nextUrl.searchParams.get("q");

  const users = await prisma.user.findMany({
    where: {
      role: roleParam ?? (q ? undefined : { in: STAFF_ROLES }),
      ...(q
        ? {
            OR: [
              { full_name: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      full_name: true,
      email: true,
      role: true,
      supervisor_id: true,
      supervisor: { select: { id: true, full_name: true } },
      assigned_country_id: true,
      assigned_country: { select: { id: true, name: true } },
      inhouse_country_assignments: { select: { country: { select: { id: true, name: true } } } },
      created_at: true,
    },
    orderBy: { full_name: "asc" },
  });

  // Flatten inhouse_country_assignments (In-House Supervisor multi-country,
  // 2026-07) into a plain assigned_countries array — regional_recruiter/
  // country_supervisor rows just get an empty array here, since they still
  // use the single assigned_country_id/assigned_country fields above.
  const data = users.map(({ inhouse_country_assignments, ...u }: (typeof users)[number]) => ({
    ...u,
    assigned_countries: inhouse_country_assignments.map((a: (typeof inhouse_country_assignments)[number]) => a.country),
  }));

  return NextResponse.json({ data });
}

// POST /api/admin/users — admin creates a brand-new staff account directly
// (rather than requiring self-registration + promotion). Replaces the old
// "temp password shown once" pattern (2026-07-27): the account is created
// with no password set, and an invite email lets the new staff member set
// their own — same shape as the candidate self-registration invite.
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }

  // FastAPI creates the account since users step 8.3
  // (vertex_be/app/api/v1/users.py) and lists the setup email, sent from
  // here.
  const result = await callBackend("/api/v1/users", { method: "POST", body });
  alertOnPrivilegeGranted(result, user!.userId);
  return pipelineResponse(result);
}
