import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { legacyErrorResponse, passFile } from "@/lib/backend";
import { queryOf } from "@/lib/pipeline";

// GET /api/admin/backup/candidates-csv?start=&end= — full, unscoped CSV
// backup of every candidate, with their latest application (programme,
// travel/visa readiness), case and document status. start/end filter on
// Candidate.created_at, inclusive. FastAPI builds it and records it on the
// audit trail before it leaves since reads handover R7c
// (vertex_be/app/api/v1/backup.py, candidates_csv).
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["admin", "operations_team", "operations_director", "director", "hr"]);
  if (guardRes) return guardRes;
  const result = await passFile("/api/v1/backup/candidates-csv", { query: queryOf(req, ["start", "end"]), timeoutMs: 60_000 });
  return result instanceof NextResponse ? result : legacyErrorResponse(result);
}
