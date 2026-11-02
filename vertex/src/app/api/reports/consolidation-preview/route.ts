import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { queryOf } from "@/lib/pipeline";

// GET /api/reports/consolidation-preview?type=weekly|monthly&period_start=&period_end=
// What the caller's consolidated report for the period would contain, from
// the verified source reports, without writing anything (Supervisory
// Reporting Framework §4.2/§4.3, §5.2/§5.3). The caller then submits it
// with POST /api/reports.
// Read from FastAPI since reads handover R3 (vertex_be/app/api/v1/dashboards.py).
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["country_supervisor", "inhouse_supervisor", "admin"]);
  if (guardRes) return guardRes;

  return backendResponse(await callBackend("/api/v1/reports/consolidation-preview", { query: queryOf(req, ["type", "period_start", "period_end"]) }));
}
