import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { seg } from "@/lib/pipeline";

// GET /api/management/partners/:id/commission-statement: one partner's
// commission statement (Phase 6): earned so far, the months still ahead, the
// balances and the recent ledger. FastAPI answers and records the view
// (vertex_be/app/api/v1/partner_performance.py); the roles must match
// MANAGERS in partner_tracking.py (tests check it).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["inhouse_supervisor", "director", "admin"]);
  if (guardRes) return guardRes;
  const { id } = await params;
  return backendResponse(await callBackend(`/api/v1/partners/${seg(id)}/commission-statement`));
}
