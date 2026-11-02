import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { queryOf, seg } from "@/lib/pipeline";

// GET /api/supervisor/recruiters/:id?period_start=...&period_end=... — one
// recruiter under the caller: performance (this month by default), targets
// against actuals, and their country's targets and allocations.
// Read from FastAPI since reads handover R3 (vertex_be/app/api/v1/dashboards.py).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["country_supervisor", "admin"]);
  if (guardRes) return guardRes;
  const { id } = await params;

  return backendResponse(await callBackend(`/api/v1/supervisor/recruiters/${seg(id)}`, { query: queryOf(req, ["period_start", "period_end"]) }));
}
