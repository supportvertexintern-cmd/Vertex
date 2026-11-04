import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { legacyErrorResponse, passFile } from "@/lib/backend";
import { BACKUP_ROLES } from "@/lib/backup-roles";
import { readJson } from "@/lib/pipeline";

export const maxDuration = 60;

// POST /api/backup/export — a full backup or a custom export, as a ZIP.
// FastAPI builds it and records it on the audit trail before it leaves
// (fail closed) since reads handover R7c (vertex_be/app/api/v1/backup.py,
// app/services/backup.py); the file streams through.
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, BACKUP_ROLES);
  if (guardRes) return guardRes;
  const read = await readJson(req, true);
  if (read.invalid) return read.invalid;
  const result = await passFile("/api/v1/backup/export", { method: "POST", body: read.body, timeoutMs: 60_000 });
  return result instanceof NextResponse ? result : legacyErrorResponse(result);
}
