import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireRole } from "@/lib/api-auth";

// GET /api/referral-agent/candidates — the agent's own referred
// candidates, narrow select only (id/name/status/stage/date). This route
// never touches Document at all, so the brief's "no document access"
// restriction falls out of the select shape itself rather than needing an
// explicit guard.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["referral_agent"]);
  if (guardRes) return guardRes;

  const agent = await prisma.referralAgent.findUnique({ where: { user_id: user!.userId } });
  if (!agent) {
    return NextResponse.json({ error: { code: "not_found", message: "Referral agent record not found." } }, { status: 404 });
  }

  const candidates = await prisma.candidate.findMany({
    where: { referral_agent_id: agent.id },
    select: {
      id: true,
      full_name: true,
      lifecycle_status: true,
      referral_duplicate_flag: true,
      created_at: true,
      applications: {
        orderBy: { submitted_at: "desc" },
        take: 1,
        select: { case: { select: { current_stage: true } } },
      },
    },
    orderBy: { created_at: "desc" },
  });

  const data = candidates.map((c: (typeof candidates)[number]) => ({
    id: c.id,
    full_name: c.full_name,
    lifecycle_status: c.lifecycle_status,
    referral_duplicate_flag: c.referral_duplicate_flag,
    created_at: c.created_at,
    current_stage: c.applications[0]?.case?.current_stage ?? null,
  }));

  return NextResponse.json({ data });
}
