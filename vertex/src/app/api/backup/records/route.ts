import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { callBackend, legacyErrorResponse } from "@/lib/backend";
import { BACKUP_ROLES } from "@/lib/backup-roles";
import { queryOf } from "@/lib/pipeline";

// GET /api/backup/records?model=Case&q=grace — record picker for the
// export builder's "specific records" filter: the table's human-readable
// label (or the linked candidate's name) or an exact id, within the
// caller's role-level row filter. FastAPI searches and records the lookup
// since reads handover R7c (vertex_be/app/api/v1/backup.py).
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, BACKUP_ROLES);
  if (guardRes) return guardRes;
  const result = await callBackend("/api/v1/backup/records", { query: queryOf(req, ["model", "q"]) });
  return result.ok ? NextResponse.json(result.body.data) : legacyErrorResponse(result);
}
