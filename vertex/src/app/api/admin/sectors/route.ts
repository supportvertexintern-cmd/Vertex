import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireAdmin, requireRole } from "@/lib/api-auth";
import { createSectorSchema } from "@/lib/validations";

// GET /api/admin/sectors — flat list, read-only reference data for every
// staff role (a recruiter completing a Candidate Information Form on
// someone's behalf needs the same "Preferred Type of Work" options a
// candidate would see); only admin can write.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["regional_recruiter", "country_supervisor", "inhouse_supervisor", "director", "marketing", "admin"]);
  if (guardRes) return guardRes;

  const sectors = await prisma.sector.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json({ data: sectors });
}

// POST /api/admin/sectors
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }

  const parsed = createSectorSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Validation failed", details: parsed.error.flatten().fieldErrors } },
      { status: 422 }
    );
  }

  const existing = await prisma.sector.findUnique({ where: { name: parsed.data.name } });
  if (existing) {
    return NextResponse.json(
      { error: { code: "duplicate", message: "A sector with this name already exists." } },
      { status: 409 }
    );
  }

  const sector = await prisma.sector.create({ data: parsed.data });
  return NextResponse.json({ data: sector }, { status: 201 });
}
