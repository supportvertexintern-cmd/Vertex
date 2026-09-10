import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireRole } from "@/lib/api-auth";

// GET /api/supervisor/team-targets — a Country Supervisor's own country's
// active campaign targets, their own recruiters, and any allocations
// already set — everything the "allocate my country's target across my
// recruiters" page needs in one call, pre-scoped server-side rather than
// asking the client to know its own country_id.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["country_supervisor", "admin"]);
  if (guardRes) return guardRes;

  const supervisor = await prisma.user.findUnique({
    where: { id: user!.userId },
    select: { assigned_country_id: true },
  });
  if (!supervisor?.assigned_country_id) {
    return NextResponse.json({ data: { campaignTargets: [], recruiters: [], allocations: [] } });
  }

  const [campaignTargets, recruiters, allocations] = await Promise.all([
    prisma.campaignTarget.findMany({
      where: { country_id: supervisor.assigned_country_id, campaign: { status: "active" } },
      select: {
        id: true,
        metric: true,
        target_value: true,
        campaign: { select: { id: true, name: true, start_date: true, end_date: true } },
      },
      orderBy: { created_at: "desc" },
    }),
    prisma.user.findMany({
      where: { role: "regional_recruiter", supervisor_id: user!.userId },
      select: { id: true, full_name: true },
      orderBy: { full_name: "asc" },
    }),
    prisma.recruiterTarget.findMany({
      where: { recruiter: { supervisor_id: user!.userId } },
      select: { id: true, campaign_target_id: true, recruiter_id: true, target_value: true },
    }),
  ]);

  return NextResponse.json({ data: { campaignTargets, recruiters, allocations } });
}
