import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { updateFeePolicySchema } from "@/lib/validations";
import { getAuthUser, requireRole } from "@/lib/api-auth";

// Pricing now lives per-Job (the opportunities catalog's service_fee_gbp
// etc.), not a separate country-level policy an In-House Supervisor
// manages — confirmed with the business, In-House no longer edits this
// (kept Director/admin-only). Still readable by every staff role below.
const FEE_POLICY_MANAGER_ROLES = ["director", "admin"] as const;

// GET /api/fee-policy — readable by any staff role (a recruiter recording
// a payment needs to know whether it's enabled), editable by Director
// (admin retains override) — see the FEE_POLICY_MANAGER_ROLES note above.
// Widened to hr/operations_team/operations_director/finance/partner
// (2026-07-31) — CaseDetail.tsx calls this unconditionally on every load
// to compute its "Milestone payments not enabled" banner, and it's now
// rendered by their portals too.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [
    "regional_recruiter",
    "country_supervisor",
    "inhouse_supervisor",
    "director",
    "admin",
    "hr",
    "operations_team",
    "operations_director",
    "finance",
    "partner",
  ]);
  if (guardRes) return guardRes;

  const policies = await prisma.feePolicy.findMany({ include: { country: { select: { name: true } } }, orderBy: { updated_at: "desc" } });
  return NextResponse.json({ data: policies });
}

// POST /api/fee-policy — SRS FR-4.5: milestone-payment policy, defaults
// disabled. Upserts by country_id (null = global default) rather than
// creating duplicate rows on every save.
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...FEE_POLICY_MANAGER_ROLES]);
  if (guardRes) return guardRes;

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = updateFeePolicySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors }, { status: 422 });
  }

  const countryId = parsed.data.country_id ?? null;
  const existing = await prisma.feePolicy.findFirst({ where: { country_id: countryId } });

  const db = auditedPrisma(user!.userId);
  const data = {
    country_id: countryId,
    enabled: parsed.data.enabled,
    documentation_amount: parsed.data.documentation_amount ?? null,
    permit_amount: parsed.data.permit_amount ?? null,
    visa_amount: parsed.data.visa_amount ?? null,
    currency: parsed.data.currency,
    updated_by: user!.userId,
  };

  const policy = existing
    ? await db.feePolicy.update({ where: { id: existing.id }, data })
    : await db.feePolicy.create({ data });

  return NextResponse.json({ data: policy });
}
