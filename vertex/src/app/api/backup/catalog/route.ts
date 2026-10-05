import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { BACKUP_ROLES, describeCatalog } from "@/server/backup/catalog";

// GET /api/backup/catalog — every table, column, enum/status value and
// relationship the caller's role may export, read live from the Prisma
// schema. Drives the export builder UI (BackupExport.tsx).
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, BACKUP_ROLES);
  if (guardRes) return guardRes;
  return NextResponse.json(describeCatalog(user!.role));
}
