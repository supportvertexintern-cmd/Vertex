import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { REFERRAL_AGENT_MANAGER_ROLES } from "@/lib/rbac";

// GET /api/admin/referral-commissions — the payout queue, filterable by
// ?countryId=, ?agentId=, ?status=. Defaults to no status filter (shows
// everything) — the UI itself defaults its own view to pending/approved.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, REFERRAL_AGENT_MANAGER_ROLES);
  if (guardRes) return guardRes;

  const countryId = req.nextUrl.searchParams.get("countryId") || undefined;
  const agentId = req.nextUrl.searchParams.get("agentId") || undefined;
  const status = req.nextUrl.searchParams.get("status") || undefined;

  const commissions = await prisma.referralCommission.findMany({
    where: {
      ...(agentId ? { referral_agent_id: agentId } : {}),
      ...(status ? { status: status as never } : {}),
      ...(countryId ? { candidate: { country_id: countryId } } : {}),
    },
    include: {
      referral_agent: { select: { id: true, full_name: true, email: true } },
      candidate: { select: { id: true, full_name: true, country: { select: { id: true, name: true } } } },
    },
    orderBy: { created_at: "desc" },
  });

  return NextResponse.json({ data: commissions });
}
