import { NextRequest } from "next/server";
import type { Role } from "@/lib/enums";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";

const REJECTED_SUBMISSION_ROLES: Role[] = [
  "regional_recruiter",
  "country_supervisor",
  "inhouse_supervisor",
  "director",
  "admin",
  "hr",
  "operations_team",
  "operations_director",
  "finance",
];

// GET /api/rejected-submissions — everything rejected the caller may see,
// newest rejection first: cases in their scope; partner submissions for
// HR and operations; self submissions for HR, unless a rejected case
// already shows them. Read from FastAPI since reads handover R5
// (vertex_be/app/api/v1/case_reads.py); the rejection dates come from the
// audit trail through vertex_rejection_dates (migration 0008).
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, REJECTED_SUBMISSION_ROLES);
  if (guardRes) return guardRes;

  return backendResponse(await callBackend("/api/v1/rejected-submissions"));
}
