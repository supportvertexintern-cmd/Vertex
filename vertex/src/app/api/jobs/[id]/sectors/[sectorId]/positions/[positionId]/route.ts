import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { updateJobPositionSchema } from "@/lib/validations";

const JOB_MANAGER_ROLES = ["marketing", "admin"] as const;

async function findScopedPosition(id: string, sectorId: string, positionId: string) {
  const position = await prisma.jobPosition.findUnique({
    where: { id: positionId },
    include: { job_sector: true },
  });
  if (!position || position.job_sector_id !== sectorId || position.job_sector.job_id !== id) return null;
  return position;
}

// PATCH /api/jobs/:id/sectors/:sectorId/positions/:positionId — edit a
// position's title/city.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; sectorId: string; positionId: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...JOB_MANAGER_ROLES]);
  if (guardRes) return guardRes;

  const { id, sectorId, positionId } = await params;
  const existing = await findScopedPosition(id, sectorId, positionId);
  if (!existing) {
    return NextResponse.json({ error: { code: "not_found", message: "Position not found on this sector." } }, { status: 404 });
  }

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 }); }

  const parsed = updateJobPositionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Validation failed", details: parsed.error.flatten().fieldErrors } },
      { status: 422 }
    );
  }

  const position = await prisma.jobPosition.update({ where: { id: positionId }, data: parsed.data });
  return NextResponse.json({ data: position });
}

// DELETE /api/jobs/:id/sectors/:sectorId/positions/:positionId
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; sectorId: string; positionId: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...JOB_MANAGER_ROLES]);
  if (guardRes) return guardRes;

  const { id, sectorId, positionId } = await params;
  const existing = await findScopedPosition(id, sectorId, positionId);
  if (!existing) {
    return NextResponse.json({ error: { code: "not_found", message: "Position not found on this sector." } }, { status: 404 });
  }

  await prisma.jobPosition.delete({ where: { id: positionId } });
  return NextResponse.json({ data: { id: positionId } });
}
