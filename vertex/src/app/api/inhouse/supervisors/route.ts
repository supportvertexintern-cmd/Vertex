import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { queryOf } from "@/lib/pipeline";

// GET /api/inhouse/supervisors — every Country Supervisor across the
// caller's assigned countries, with a performance summary.
// Read from FastAPI since reads handover R3 (vertex_be/app/api/v1/dashboards.py).
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["inhouse_supervisor", "admin"]);
  if (guardRes) return guardRes;

  return backendResponse(await callBackend("/api/v1/inhouse/supervisors", { query: queryOf(req, ["period_start", "period_end"]) }));
}
