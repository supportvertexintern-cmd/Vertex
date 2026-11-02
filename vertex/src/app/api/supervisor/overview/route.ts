import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { queryOf } from "@/lib/pipeline";

// GET /api/supervisor/overview?period_start=...&period_end=... — the Country
// Overview tab: the supervisor's country, work awaiting them, and its
// progress against the campaign targets that touch it.
// Read from FastAPI since reads handover R3 (vertex_be/app/api/v1/dashboards.py).
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["country_supervisor", "admin"]);
  if (guardRes) return guardRes;

  return backendResponse(await callBackend("/api/v1/supervisor/overview", { query: queryOf(req, ["period_start", "period_end"]) }));
}
