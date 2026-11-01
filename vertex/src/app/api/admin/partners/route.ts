import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { passOn } from "@/lib/pipeline";

// Who "sets policy & criteria" for partner agreements (Regional Supervisory
// Operational Workflow p.3) — same manager tier as Fee Policy.
const PARTNER_MANAGER_ROLES = ["inhouse_supervisor", "director", "admin"] as const;

// GET /api/admin/partners — readable by any staff role that can attribute
// a candidate to one (a recruiter registering a lead needs this list, not
// just management). hr/operations_team/operations_director added
// (CRM Comments item 10, 2026-08-10) for the on-behalf-of partner picker.
// finance added (2026-08-18) for the Partner filter dropdown on its own
// Payments Due / Created Cases lists.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [
    "regional_recruiter", "country_supervisor", "inhouse_supervisor", "director", "admin", "hr", "operations_team", "operations_director", "finance",
  ]);
  if (guardRes) return guardRes;

  const partners = await prisma.partner.findMany({
    include: { _count: { select: { candidates: true } } },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ data: partners });
}

// POST /api/admin/partners — In-House Supervisor/Director (admin retains override).
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...PARTNER_MANAGER_ROLES]);
  if (guardRes) return guardRes;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }

  // FastAPI writes since users step 8.4 (vertex_be/app/api/v1/partner_agencies.py).
  return passOn("/api/v1/partners", { method: "POST", body });
}
