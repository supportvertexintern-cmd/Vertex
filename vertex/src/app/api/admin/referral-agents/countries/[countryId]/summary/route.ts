import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { REFERRAL_AGENT_MANAGER_ROLES } from "@/lib/rbac";
import { computeReferralAgentPerformance } from "@/server/services/kpi";

// GET /api/admin/referral-agents/countries/:countryId/summary — one
// aggregate query for the Country Management hub's detail page, reusing
// the same queries §6/7.1-7.4 already need rather than a new data model.
// Programmes are read-only here — Job.country is a plain string (no FK to
// Country), matched case-insensitively against this country's own name,
// same pattern current_location_country_name matching already uses.
export async function GET(req: NextRequest, { params }: { params: Promise<{ countryId: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, REFERRAL_AGENT_MANAGER_ROLES);
  if (guardRes) return guardRes;

  const { countryId } = await params;
  const country = await prisma.country.findUnique({ where: { id: countryId } });
  if (!country) {
    return NextResponse.json({ error: { code: "not_found", message: "Country not found." } }, { status: 404 });
  }

  const [agents, milestoneBreakdown, jobs, performance, pendingCommissionTotal] = await Promise.all([
    prisma.referralAgent.findMany({
      where: { country_id: countryId },
      select: { id: true, full_name: true, status: true, referral_code: true, _count: { select: { candidates: true } } },
      orderBy: { full_name: "asc" },
    }),
    prisma.referralCommission.groupBy({
      by: ["milestone"],
      where: { candidate: { country_id: countryId } },
      _count: true,
    }),
    prisma.job.findMany({
      where: { country: { equals: country.name, mode: "insensitive" } },
      select: { id: true, title: true, city: true, status: true },
      orderBy: { title: "asc" },
    }),
    computeReferralAgentPerformance({ countryId }),
    prisma.referralCommission.aggregate({
      where: { status: "pending", candidate: { country_id: countryId } },
      _sum: { amount: true },
    }),
  ]);

  const milestoneCounts: Record<string, number> = {
    registered: 0,
    qualified: 0,
    application_submitted: 0,
    work_permit_approved: 0,
    visa_approved: 0,
    deployed: 0,
  };
  for (const row of milestoneBreakdown) {
    milestoneCounts[row.milestone] = row._count;
  }

  return NextResponse.json({
    data: {
      country: { id: country.id, name: country.name },
      agents,
      milestoneCounts,
      jobs,
      performance,
      pendingCommissionTotal: pendingCommissionTotal._sum.amount ?? 0,
    },
  });
}
