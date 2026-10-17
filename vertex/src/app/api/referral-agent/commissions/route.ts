import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireRole } from "@/lib/api-auth";

// GET /api/referral-agent/commissions — the agent's own commission ledger.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["referral_agent"]);
  if (guardRes) return guardRes;

  const agent = await prisma.referralAgent.findUnique({ where: { user_id: user!.userId } });
  if (!agent) {
    return NextResponse.json({ error: { code: "not_found", message: "Referral agent record not found." } }, { status: 404 });
  }

  const commissions = await prisma.referralCommission.findMany({
    where: { referral_agent_id: agent.id },
    include: { candidate: { select: { id: true, full_name: true } } },
    orderBy: { created_at: "desc" },
  });

  return NextResponse.json({ data: commissions });
}
