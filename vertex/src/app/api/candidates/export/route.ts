import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { scopeCandidatesToRequester } from "@/server/scope";

const STAFF_ROLES = ["regional_recruiter", "country_supervisor", "inhouse_supervisor", "director", "admin"] as const;

function csvEscape(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

// GET /api/candidates/export — CSV export of the candidate list (SRS
// FR-3.8), reusing the same role scoping as the live dashboard so an
// exported file can never contain more than the viewer could already see.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...STAFF_ROLES]);
  if (guardRes) return guardRes;

  const scope = await scopeCandidatesToRequester(user!);

  const candidates = await prisma.candidate.findMany({
    where: scope,
    select: {
      full_name: true,
      nationality: true,
      desired_role: true,
      lifecycle_status: true,
      screening_result: true,
      phone: true,
      email: true,
      created_at: true,
      user: { select: { full_name: true, email: true } },
      recruiter: { select: { full_name: true } },
      country: { select: { name: true, region: { select: { name: true } } } },
    },
    orderBy: { created_at: "desc" },
  });

  // Standard candidate-list data (Regional Supervisory Operational
  // Workflow p.7): name, region, role, contact, screening result, status,
  // date — screening result and status are two distinct fields, not one.
  const header = ["Name", "Nationality", "Region", "Country", "Recruiter", "Desired Role", "Contact", "Screening Result", "Status", "Date"];
  const rows = candidates.map((c: (typeof candidates)[number]) => [
    c.user?.full_name ?? c.full_name ?? "",
    c.nationality ?? "",
    c.country?.region.name ?? "",
    c.country?.name ?? "",
    c.recruiter?.full_name ?? "",
    c.desired_role ?? "",
    c.user?.email ?? c.email ?? c.phone ?? "",
    c.screening_result === null ? "Not yet evaluated" : c.screening_result ? "Passed" : "Failed",
    c.lifecycle_status,
    c.created_at.toISOString().slice(0, 10),
  ]);

  const csv = [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="candidates-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
