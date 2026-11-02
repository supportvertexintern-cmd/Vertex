import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { queryOf } from "@/lib/pipeline";

// GET /api/management/report-metrics?cadence=&country_id=&q=&page=&pageSize=
// Director/Management's view of recruiter and country-supervisor reporting:
// counts by status and the latest period, never the content, which stays
// In-House's to review. Answers { data, total, page, pageSize }.
// Read from FastAPI since reads handover R3 (vertex_be/app/api/v1/dashboards.py).
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["director", "admin"]);
  if (guardRes) return guardRes;

  return backendResponse(await callBackend("/api/v1/management/report-metrics", { query: queryOf(req, ["cadence", "country_id", "q", "page", "pageSize"]) }));
}
