import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { queryOf } from "@/lib/pipeline";

// GET /api/recruiter-targets/progress?period_start=...&period_end=... — the
// calling recruiter's own target-vs-actual for a report period.
// Read from FastAPI since reads handover R3 (vertex_be/app/api/v1/dashboards.py).
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["regional_recruiter"]);
  if (guardRes) return guardRes;

  return backendResponse(await callBackend("/api/v1/recruiter-targets/progress", { query: queryOf(req, ["period_start", "period_end"]) }));
}
