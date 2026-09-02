import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireRole } from "@/lib/api-auth";

const JOB_MANAGER_ROLES = ["marketing", "admin"] as const;

// DELETE /api/jobs/:id/sectors/:sectorId — detaches a sector from this
// programme, cascading its positions (JobPosition.job_sector_id is
// onDelete: Cascade).
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; sectorId: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...JOB_MANAGER_ROLES]);
  if (guardRes) return guardRes;

  const { id, sectorId } = await params;
  const sector = await prisma.jobSector.findUnique({ where: { id: sectorId } });
  if (!sector || sector.job_id !== id) {
    return NextResponse.json({ error: { code: "not_found", message: "Sector not found on this programme." } }, { status: 404 });
  }

  await prisma.jobSector.delete({ where: { id: sectorId } });
  return NextResponse.json({ data: { id: sectorId } });
}
