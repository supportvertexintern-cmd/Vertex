import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";

// GET /api/management/partner-performance: every partner's onboarding,
// applications, flags and earned commissions, each team member's rollup, and
// the commission and admin-fee totals (Phase 6). FastAPI answers
// (vertex_be/app/api/v1/partner_performance.py); the roles must match MANAGERS
// in partner_tracking.py (tests check it).
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["inhouse_supervisor", "director", "admin"]);
  if (guardRes) return guardRes;
  return backendResponse(await callBackend("/api/v1/partner-performance"));
}
