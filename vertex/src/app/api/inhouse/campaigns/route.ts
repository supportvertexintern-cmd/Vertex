import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { getInhouseAssignedCountryIds } from "@/server/scope";

// GET /api/inhouse/campaigns — every campaign (any status, not just
// active), with only this In-House Supervisor's own assigned countries'
// targets attached (not every country/region's, unlike the Management
// campaigns view). Not filtered to "active" — In-House creates campaigns
// for their own countries (SRS §2.2) which Country Supervisors then draw
// on, so they need to see and keep managing a campaign while it's still
// in draft, not just after someone else activates it.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["inhouse_supervisor", "admin"]);
  if (guardRes) return guardRes;

  const countryIds = await getInhouseAssignedCountryIds(user!.userId);
  if (!countryIds.length) {
    return NextResponse.json({ data: { countryIds: [], countries: [], campaigns: [] } });
  }

  const countries = await prisma.country.findMany({
    where: { id: { in: countryIds } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const campaigns = await prisma.campaign.findMany({
    select: {
      id: true,
      name: true,
      status: true,
      start_date: true,
      end_date: true,
      created_by: true,
      targets: {
        where: { country_id: { in: countryIds } },
        select: { id: true, metric: true, target_value: true, country: { select: { id: true, name: true } } },
      },
    },
    orderBy: { created_at: "desc" },
  });

  return NextResponse.json({ data: { countryIds, countries, userId: user!.userId, campaigns } });
}
