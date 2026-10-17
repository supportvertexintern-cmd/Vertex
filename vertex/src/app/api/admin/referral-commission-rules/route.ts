import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { REFERRAL_AGENT_MANAGER_ROLES } from "@/lib/rbac";
import { upsertReferralCommissionRuleSchema } from "@/lib/validations";

// GET /api/admin/referral-commission-rules — every rule on file, optional
// ?countryId= filter (reused by the Country Management hub, §7.6). A
// missing (country, milestone) row is treated as an implicit amount-0 rule
// everywhere it's read (generateReferralCommissionIfDue) — the grid UI
// fills in the gaps client-side rather than the API pre-seeding every
// combination.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, REFERRAL_AGENT_MANAGER_ROLES);
  if (guardRes) return guardRes;

  const countryId = req.nextUrl.searchParams.get("countryId") || undefined;

  const rules = await prisma.referralCommissionRule.findMany({
    where: countryId ? { country_id: countryId } : undefined,
    include: { country: { select: { id: true, name: true } } },
    orderBy: [{ country: { name: "asc" } }, { milestone: "asc" }],
  });

  return NextResponse.json({ data: rules });
}

// POST /api/admin/referral-commission-rules — upserts by (country_id,
// milestone) via a find-then-create/update, same "avoid duplicate rows on
// every save" idiom as /api/fee-policy — a plain Prisma .upsert() would
// bypass auditedPrisma's create/update interception entirely (it only
// wraps those two operations, not upsert), and this model is deliberately
// in AUDITED_MODELS.
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, REFERRAL_AGENT_MANAGER_ROLES);
  if (guardRes) return guardRes;

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 }); }

  const parsed = upsertReferralCommissionRuleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Validation failed", details: parsed.error.flatten().fieldErrors } },
      { status: 422 }
    );
  }

  const { country_id, milestone, amount, currency } = parsed.data;
  const existing = await prisma.referralCommissionRule.findUnique({ where: { country_id_milestone: { country_id, milestone } } });

  const db = auditedPrisma(user!.userId);
  const data = { country_id, milestone, amount, currency, updated_by: user!.userId };
  const rule = existing
    ? await db.referralCommissionRule.update({ where: { id: existing.id }, data })
    : await db.referralCommissionRule.create({ data });

  return NextResponse.json({ data: rule });
}
