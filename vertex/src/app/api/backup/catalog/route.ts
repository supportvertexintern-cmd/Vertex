import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { callBackend, legacyErrorResponse } from "@/lib/backend";
import { BACKUP_ROLES } from "@/lib/backup-roles";

// GET /api/backup/catalog — every table, column, enum/status value and
// relationship the caller's role may export. Drives the export builder UI
// (BackupExport.tsx). From FastAPI since reads handover R7c
// (vertex_be/app/services/backup.py), read from its models.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, BACKUP_ROLES);
  if (guardRes) return guardRes;
  const result = await callBackend("/api/v1/backup/catalog");
  return result.ok ? NextResponse.json(result.body.data) : legacyErrorResponse(result);
}
