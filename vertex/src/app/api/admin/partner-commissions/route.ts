import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { queryOf } from "@/lib/pipeline";

// GET /api/admin/partner-commissions?partnerId=&ruleType=&status=: the partner
// commissions that are due (Phase 6). FastAPI answers
// (vertex_be/app/api/v1/partner_ledgers.py); the roles must match MANAGERS in
// partner_tracking.py (tests check it).
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["inhouse_supervisor", "director", "admin"]);
  if (guardRes) return guardRes;
  return backendResponse(await callBackend("/api/v1/partner-commissions", { query: queryOf(req, ["partnerId", "ruleType", "status"]) }));
}
