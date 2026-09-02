import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { createJobPositionSchema } from "@/lib/validations";

const JOB_MANAGER_ROLES = ["marketing", "admin"] as const;

// POST /api/jobs/:id/sectors/:sectorId/positions — adds a specific
// position under one programme's sector (2026-09-02), e.g. "Grape Picker"
// under Italy's Agriculture sector.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; sectorId: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...JOB_MANAGER_ROLES]);
  if (guardRes) return guardRes;

  const { id, sectorId } = await params;
  const sector = await prisma.jobSector.findUnique({ where: { id: sectorId } });
  if (!sector || sector.job_id !== id) {
    return NextResponse.json({ error: { code: "not_found", message: "Sector not found on this programme." } }, { status: 404 });
  }

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 }); }

  const parsed = createJobPositionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Validation failed", details: parsed.error.flatten().fieldErrors } },
      { status: 422 }
    );
  }

  const position = await prisma.jobPosition.create({
    data: { job_sector_id: sectorId, title: parsed.data.title, city: parsed.data.city },
  });

  return NextResponse.json({ data: position }, { status: 201 });
}
