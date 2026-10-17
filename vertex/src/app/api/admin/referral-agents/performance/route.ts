import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { REFERRAL_AGENT_MANAGER_ROLES } from "@/lib/rbac";
import { computeReferralAgentPerformance } from "@/server/services/kpi";

// GET /api/admin/referral-agents/performance — live ranking, ?countryId=
// filterable. Reused as-is by the Country Management hub (§7.6).
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, REFERRAL_AGENT_MANAGER_ROLES);
  if (guardRes) return guardRes;

  const countryId = req.nextUrl.searchParams.get("countryId") || undefined;
  const performance = await computeReferralAgentPerformance({ countryId });

  return NextResponse.json({ data: performance });
}
