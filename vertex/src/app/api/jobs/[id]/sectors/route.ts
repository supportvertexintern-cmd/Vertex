import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { createJobSectorSchema } from "@/lib/validations";

// Job postings are Marketing's sole responsibility (same reasoning as
// /api/jobs/[id]'s own JOB_MANAGER_ROLES — duplicated locally per that
// file's own established convention rather than hoisted to a shared
// constant). Admin keeps override access.
const JOB_MANAGER_ROLES = ["marketing", "admin"] as const;

// POST /api/jobs/:id/sectors — attaches one of the 8 canonical sectors to
// a programme (2026-09-02). id = the parent Job's id.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...JOB_MANAGER_ROLES]);
  if (guardRes) return guardRes;

  const { id } = await params;
  const job = await prisma.job.findUnique({ where: { id } });
  if (!job) {
    return NextResponse.json({ error: { code: "not_found", message: "Job not found." } }, { status: 404 });
  }

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 }); }

  const parsed = createJobSectorSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Validation failed", details: parsed.error.flatten().fieldErrors } },
      { status: 422 }
    );
  }

  const existing = await prisma.jobSector.findUnique({
    where: { job_id_sector: { job_id: id, sector: parsed.data.sector } },
  });
  if (existing) {
    return NextResponse.json({ error: { code: "duplicate", message: "This sector is already attached to this programme." } }, { status: 409 });
  }

  const sector = await prisma.jobSector.create({
    data: { job_id: id, sector: parsed.data.sector },
    include: { positions: true },
  });

  return NextResponse.json({ data: sector }, { status: 201 });
}
