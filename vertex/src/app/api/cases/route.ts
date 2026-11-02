import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { queryOf } from "@/lib/pipeline";

const CASE_ACCESS_ROLES = ["candidate", "regional_recruiter", "country_supervisor", "inhouse_supervisor", "director", "admin", "partner", "hr", "operations_team", "operations_director", "finance"] as const;

// GET /api/cases — the mobility-lifecycle case list (SRS FR-4.1/4.2),
// scoped exactly like the candidate list (recruiter sees their own
// candidates' cases, supervisor their country's, management/admin all, a
// candidate sees only their own). Active cases unless ?status=all or
// ?status=rejected; filtered by stage, country, candidate, partner, source
// and opportunity (with the options on ?filterOptions=true), searched,
// sorted and paged ({ data, total, page, pageSize }, 50 rows by default).
// Read from FastAPI since reads handover R5
// (vertex_be/app/api/v1/case_reads.py).
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...CASE_ACCESS_ROLES]);
  if (guardRes) return guardRes;

  const query = queryOf(req, [
    "stage", "country_id", "candidate_id", "q", "partner_id", "source", "country", "programme", "programmeCountry",
    "filterOptions", "status", "page", "pageSize", "sortBy", "sortDir",
  ]);
  return backendResponse(await callBackend("/api/v1/cases", { query }));
}
