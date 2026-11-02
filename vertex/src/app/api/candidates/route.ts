import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { queryOf } from "@/lib/pipeline";

const STAFF_ROLES = ["regional_recruiter", "country_supervisor", "inhouse_supervisor", "director", "admin", "hr"] as const;

// POST /api/candidates has been retired — a candidate (recruiter-sourced
// or self-service) is now created by submitting the Candidate Information
// Form itself (POST /api/applications), which is the first thing anyone
// fills in. See docs/PLATFORM_ARCHITECTURE.md.

// GET /api/candidates — the caller's candidates (SRS FR-1.2, FR-2.3): a
// recruiter's own, a supervisor's country, an In-House Supervisor's
// countries, everything for director, admin and HR. With period_start and
// period_end, every one created in that window (the recruiter's report);
// otherwise searched, filtered, sorted and paged ({ data, total, page,
// pageSize }), with the opportunity filter options (?filterOptions=true)
// and HR's attention signals and summary (?signals=true) on request.
// Read from FastAPI since reads handover R4
// (vertex_be/app/api/v1/pipeline_reads.py).
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...STAFF_ROLES]);
  if (guardRes) return guardRes;

  const query = queryOf(req, [
    "period_start", "period_end", "q", "status", "source", "country_id", "country", "programme", "programmeCountry",
    "filterOptions", "signals", "page", "pageSize", "sortBy", "sortDir",
  ]);
  return backendResponse(await callBackend("/api/v1/candidates", { query }));
}
