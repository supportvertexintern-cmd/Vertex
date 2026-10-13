import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireRole, forbidden } from "@/lib/api-auth";
import { createCampaignTargetSchema } from "@/lib/validations";
import { getInhouseAssignedCountryIds } from "@/server/scope";

const CAMPAIGN_MANAGER_ROLES = ["inhouse_supervisor", "director", "admin"] as const;
const CROSS_COUNTRY_ROLES = ["director", "admin"] as const;

// POST /api/campaigns/:id/targets — cascades a numeric target to a
// country, a region, or the whole campaign (SRS FR-3.3 "cascade them to
// countries/regions"). Not wrapped in auditedPrisma: CampaignTarget isn't
// in AUDITED_MODELS since it's a child row of an already-audited Campaign
// edit, not an independently meaningful audit event on its own.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...CAMPAIGN_MANAGER_ROLES]);
  if (guardRes) return guardRes;

  const { id: campaignId } = await params;

  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) {
    return NextResponse.json({ error: { code: "not_found", message: "Campaign not found." } }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }

  const parsed = createCampaignTargetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Validation failed", details: parsed.error.flatten().fieldErrors } },
      { status: 422 }
    );
  }

  // In-House Supervisor can only set a target scoped to one of their own
  // assigned countries, never a region or someone else's country.
  // Director/admin keep the full cross-country/region reach.
  let targetData = parsed.data;
  if (!CROSS_COUNTRY_ROLES.includes(user!.role as (typeof CROSS_COUNTRY_ROLES)[number])) {
    const countryIds = await getInhouseAssignedCountryIds(user!.userId);
    if (!countryIds.length) {
      return NextResponse.json({ error: { code: "no_country", message: "You must be assigned a country first." } }, { status: 422 });
    }
    if (parsed.data.region_id || (parsed.data.country_id && !countryIds.includes(parsed.data.country_id))) {
      return forbidden({ error: { code: "forbidden", message: "You can only set targets for one of your own assigned countries." } });
    }
    // A single-country supervisor can omit country_id (defaults to their
    // one country, preserving prior behavior); with several assigned
    // countries the client must say which one.
    const country_id = parsed.data.country_id ?? (countryIds.length === 1 ? countryIds[0] : undefined);
    if (!country_id) {
      return NextResponse.json({ error: { code: "validation_error", message: "Specify which of your assigned countries this target is for." } }, { status: 422 });
    }
    targetData = { ...parsed.data, country_id, region_id: undefined };
  }

  const target = await prisma.campaignTarget.create({
    data: { ...targetData, campaign_id: campaignId },
    select: {
      id: true,
      metric: true,
      target_value: true,
      country: { select: { id: true, name: true } },
      region: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({ data: target }, { status: 201 });
}
