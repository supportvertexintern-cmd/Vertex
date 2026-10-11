import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireRole, forbidden } from "@/lib/api-auth";
import { getInhouseAssignedCountryIds } from "@/server/scope";

const CAMPAIGN_MANAGER_ROLES = ["inhouse_supervisor", "director", "admin"] as const;

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; targetId: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...CAMPAIGN_MANAGER_ROLES]);
  if (guardRes) return guardRes;

  const { id: campaignId, targetId } = await params;

  const target = await prisma.campaignTarget.findUnique({ where: { id: targetId } });
  if (!target || target.campaign_id !== campaignId) {
    return NextResponse.json({ error: { code: "not_found", message: "Target not found." } }, { status: 404 });
  }

  if (user!.role === "inhouse_supervisor") {
    const countryIds = await getInhouseAssignedCountryIds(user!.userId);
    if (!target.country_id || !countryIds.includes(target.country_id)) {
      return forbidden({ error: { code: "forbidden", message: "You can only remove targets for one of your own assigned countries." } });
    }
  }

  await prisma.campaignTarget.delete({ where: { id: targetId } });
  return NextResponse.json({ data: { id: targetId } });
}
