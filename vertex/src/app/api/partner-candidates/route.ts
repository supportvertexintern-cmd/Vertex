import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { queryOf } from "@/lib/pipeline";
import { HR_ROLES } from "@/lib/rbac";

// GET /api/partner-candidates — HR's and Operations' queue of partner
// submissions (SRS FR-5.1): every submitted one, never a draft, across all
// countries (policy Q2, owner's decision 2026-11-02), searched, filtered,
// sorted and paged, with document completeness, attention signals, the
// queue's totals and the opportunity filter options.
// Read from FastAPI since reads handover R4
// (vertex_be/app/api/v1/pipeline_reads.py).
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...HR_ROLES, "operations_team", "operations_director"]);
  if (guardRes) return guardRes;

  const query = queryOf(req, ["q", "status", "page", "pageSize", "sortBy", "sortDir", "country", "programme", "programmeCountry"]);
  return backendResponse(await callBackend("/api/v1/partner-candidates", { query }));
}
