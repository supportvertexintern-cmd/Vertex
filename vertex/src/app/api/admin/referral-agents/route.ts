import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { REFERRAL_AGENT_MANAGER_ROLES } from "@/lib/rbac";

// GET /api/admin/referral-agents — list, Director/Admin only. Optional
// ?countryId= filter, reused as-is by the Country Management hub (§7.6)
// rather than a separate query.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, REFERRAL_AGENT_MANAGER_ROLES);
  if (guardRes) return guardRes;

  const countryId = req.nextUrl.searchParams.get("countryId") || undefined;

  const agents = await prisma.referralAgent.findMany({
    where: countryId ? { country_id: countryId } : undefined,
    include: {
      countryRef: { select: { id: true, name: true } },
      _count: { select: { candidates: true, commissions: true } },
    },
    orderBy: { created_at: "desc" },
  });

  return NextResponse.json({ data: agents });
}
