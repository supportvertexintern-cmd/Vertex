import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { queryOf } from "@/lib/pipeline";

// GET /api/kpi — Management/Control dashboard data (SRS FR-3.1, FR-3.2,
// FR-3.8): the last 90 days unless a period is given; an In-House
// Supervisor is held to their own countries.
// Read from FastAPI since reads handover R3 (vertex_be/app/api/v1/dashboards.py).
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["inhouse_supervisor", "director", "admin"]);
  if (guardRes) return guardRes;

  return backendResponse(await callBackend("/api/v1/kpi", { query: queryOf(req, ["period_start", "period_end", "country_id", "region_id", "recruiter_id", "campaign_id"]) }));
}
