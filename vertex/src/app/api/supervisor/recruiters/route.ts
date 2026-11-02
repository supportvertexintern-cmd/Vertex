import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { queryOf } from "@/lib/pipeline";

// GET /api/supervisor/recruiters?period_start=...&period_end=... — the
// Recruiters tab: the caller's recruiters with a performance summary
// (all time when no period is given).
// Read from FastAPI since reads handover R3 (vertex_be/app/api/v1/dashboards.py).
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["country_supervisor", "admin"]);
  if (guardRes) return guardRes;

  return backendResponse(await callBackend("/api/v1/supervisor/recruiters", { query: queryOf(req, ["period_start", "period_end"]) }));
}
