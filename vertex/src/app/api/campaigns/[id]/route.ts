import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { updateCampaignSchema } from "@/lib/validations";

const STAFF_ROLES = ["regional_recruiter", "country_supervisor", "inhouse_supervisor", "director", "admin"] as const;
// See the matching comment in /api/campaigns/route.ts — In-House creates
// campaigns for their own country. An In-House Supervisor may only edit/
// delete a campaign they themselves created (checked below), not another
// country's; Director/admin can touch any.
const CAMPAIGN_MANAGER_ROLES = ["inhouse_supervisor", "director", "admin"] as const;
const CROSS_CAMPAIGN_ROLES = ["director", "admin"] as const;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...STAFF_ROLES]);
  if (guardRes) return guardRes;

  const { id } = await params;
  const campaign = await prisma.campaign.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      criteria: true,
      status: true,
      start_date: true,
      end_date: true,
      creator: { select: { id: true, full_name: true } },
      targets: {
        select: {
          id: true,
          metric: true,
          target_value: true,
          country: { select: { id: true, name: true } },
          region: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!campaign) {
    return NextResponse.json({ error: { code: "not_found", message: "Campaign not found." } }, { status: 404 });
  }

  return NextResponse.json({ data: campaign });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...CAMPAIGN_MANAGER_ROLES]);
  if (guardRes) return guardRes;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }

  const parsed = updateCampaignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Validation failed", details: parsed.error.flatten().fieldErrors } },
      { status: 422 }
    );
  }

  const existing = await prisma.campaign.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: { code: "not_found", message: "Campaign not found." } }, { status: 404 });
  }

  if (!CROSS_CAMPAIGN_ROLES.includes(user!.role as (typeof CROSS_CAMPAIGN_ROLES)[number]) && existing.created_by !== user!.userId) {
    return NextResponse.json({ error: { code: "forbidden", message: "You can only edit campaigns you created." } }, { status: 403 });
  }

  const { start_date, end_date, ...rest } = parsed.data;

  const updated = await auditedPrisma(user!.userId).campaign.update({
    where: { id },
    data: {
      ...rest,
      ...(start_date ? { start_date: new Date(start_date) } : {}),
      ...(end_date ? { end_date: new Date(end_date) } : {}),
    },
    select: { id: true, name: true, status: true, start_date: true, end_date: true },
  });

  return NextResponse.json({ data: updated });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...CAMPAIGN_MANAGER_ROLES]);
  if (guardRes) return guardRes;

  const { id } = await params;
  const existing = await prisma.campaign.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: { code: "not_found", message: "Campaign not found." } }, { status: 404 });
  }

  if (!CROSS_CAMPAIGN_ROLES.includes(user!.role as (typeof CROSS_CAMPAIGN_ROLES)[number]) && existing.created_by !== user!.userId) {
    return NextResponse.json({ error: { code: "forbidden", message: "You can only delete campaigns you created." } }, { status: 403 });
  }

  await auditedPrisma(user!.userId).campaign.delete({ where: { id } });
  return NextResponse.json({ data: { id } });
}
