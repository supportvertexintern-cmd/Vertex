import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { backendResponse, callBackend } from "@/lib/backend";
import { readJson } from "@/lib/pipeline";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { REFERRAL_AGENT_MANAGER_ROLES } from "@/lib/rbac";

// GET /api/admin/referral-commission-rules — every rule on file, optional
// ?countryId= filter (reused by the Country Management hub, §7.6). A
// missing (country, milestone) row is treated as an implicit amount-0 rule
// everywhere it's read (FastAPI's commission_if_due) — the grid UI
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

// POST /api/admin/referral-commission-rules — set the amount for a (country,
// milestone); the existing rule is updated. Written by FastAPI since
// payments step 7.1 (vertex_be/app/api/v1/referral_commissions.py,
// upsert_rule).
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, REFERRAL_AGENT_MANAGER_ROLES);
  if (guardRes) return guardRes;
  const read = await readJson(req);
  if (read.invalid) return read.invalid;
  const result = await callBackend("/api/v1/referral-commission-rules", { method: "POST", body: read.body });
  return backendResponse(result);
}
