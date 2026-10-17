import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { REFERRAL_AGENT_MANAGER_ROLES } from "@/lib/rbac";

// GET /api/admin/referral-agents/countries — every Country with quick
// Referral Agent System counts (active agents, candidates referred,
// pending commission total), for the Country Management hub's list page.
// Country/Region CRUD itself is unchanged and still lives at
// /admin/regions — this is a new, additive aggregate view only.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, REFERRAL_AGENT_MANAGER_ROLES);
  if (guardRes) return guardRes;

  const countries = await prisma.country.findMany({
    include: {
      _count: { select: { referral_agents: true } },
    },
    orderBy: { name: "asc" },
  });

  const data = await Promise.all(
    countries.map(async (country: (typeof countries)[number]) => {
      const [activeAgents, candidatesReferred, pendingCommissions] = await Promise.all([
        prisma.referralAgent.count({ where: { country_id: country.id, status: "active" } }),
        prisma.candidate.count({ where: { country_id: country.id, referral_agent_id: { not: null } } }),
        prisma.referralCommission.aggregate({
          where: { status: "pending", candidate: { country_id: country.id } },
          _sum: { amount: true },
        }),
      ]);
      return {
        id: country.id,
        name: country.name,
        activeAgents,
        candidatesReferred,
        pendingCommissionTotal: pendingCommissions._sum.amount ?? 0,
      };
    })
  );

  return NextResponse.json({ data });
}
