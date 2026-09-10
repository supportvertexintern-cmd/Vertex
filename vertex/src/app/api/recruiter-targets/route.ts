import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { upsertRecruiterTargetSchema } from "@/lib/validations";

const STAFF_ROLES = ["regional_recruiter", "country_supervisor", "inhouse_supervisor", "director", "admin"] as const;
// Country Supervisor allocates their country's campaign target across
// their own recruiters — the same tier that already manages the rest of
// the recruiter/country relationship (role/supervisor assignment lives
// under admin, but day-to-day team target-setting is the supervisor's).
const TARGET_SETTER_ROLES = ["country_supervisor", "admin"] as const;

// GET /api/recruiter-targets?campaign_target_id=... — scoped: a recruiter
// sees only their own allocation, a supervisor sees their own recruiters',
// management/admin see everything.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...STAFF_ROLES]);
  if (guardRes) return guardRes;

  const campaignTargetId = req.nextUrl.searchParams.get("campaign_target_id") ?? undefined;

  const where: { campaign_target_id?: string; recruiter_id?: string; recruiter?: { supervisor_id: string } } = {
    ...(campaignTargetId ? { campaign_target_id: campaignTargetId } : {}),
  };
  if (user!.role === "regional_recruiter") {
    where.recruiter_id = user!.userId;
  } else if (user!.role === "country_supervisor") {
    where.recruiter = { supervisor_id: user!.userId };
  }

  const targets = await prisma.recruiterTarget.findMany({
    where,
    select: {
      id: true,
      campaign_target_id: true,
      target_value: true,
      updated_at: true,
      recruiter: { select: { id: true, full_name: true } },
      campaign_target: {
        select: {
          id: true,
          metric: true,
          target_value: true,
          country: { select: { id: true, name: true } },
          campaign: { select: { id: true, name: true, start_date: true, end_date: true, status: true } },
        },
      },
    },
    orderBy: { updated_at: "desc" },
  });

  return NextResponse.json({ data: targets });
}

// POST /api/recruiter-targets — upsert one recruiter's allocation of a
// campaign target. A supervisor may only set it for a recruiter they
// actually supervise, against a campaign target scoped to their own
// country — both checked server-side, not just left to the UI.
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...TARGET_SETTER_ROLES]);
  if (guardRes) return guardRes;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }

  const parsed = upsertRecruiterTargetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Validation failed", details: parsed.error.flatten().fieldErrors } },
      { status: 422 }
    );
  }

  const { campaign_target_id, recruiter_id, target_value } = parsed.data;

  const [campaignTarget, recruiter] = await Promise.all([
    prisma.campaignTarget.findUnique({ where: { id: campaign_target_id }, select: { id: true, country_id: true } }),
    prisma.user.findUnique({ where: { id: recruiter_id }, select: { id: true, role: true, supervisor_id: true, assigned_country_id: true } }),
  ]);
  if (!campaignTarget) {
    return NextResponse.json({ error: { code: "not_found", message: "Campaign target not found." } }, { status: 404 });
  }
  if (!recruiter || recruiter.role !== "regional_recruiter") {
    return NextResponse.json({ error: { code: "not_found", message: "Recruiter not found." } }, { status: 404 });
  }

  if (user!.role === "country_supervisor") {
    if (recruiter.supervisor_id !== user!.userId) {
      return NextResponse.json({ error: { code: "forbidden", message: "You can only set targets for recruiters you supervise." } }, { status: 403 });
    }
    if (!campaignTarget.country_id || campaignTarget.country_id !== recruiter.assigned_country_id) {
      return NextResponse.json({ error: { code: "forbidden", message: "This campaign target isn't scoped to your recruiter's country." } }, { status: 403 });
    }
  }

  const db = auditedPrisma(user!.userId);
  const target = await db.recruiterTarget.upsert({
    where: { campaign_target_id_recruiter_id: { campaign_target_id, recruiter_id } },
    update: { target_value, set_by: user!.userId },
    create: { campaign_target_id, recruiter_id, target_value, set_by: user!.userId },
    select: {
      id: true,
      campaign_target_id: true,
      target_value: true,
      updated_at: true,
      recruiter: { select: { id: true, full_name: true } },
    },
  });

  return NextResponse.json({ data: target }, { status: 201 });
}
