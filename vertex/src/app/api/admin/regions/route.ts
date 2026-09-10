import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireAdmin, requireRole } from "@/lib/api-auth";
import { createRegionSchema } from "@/lib/validations";

// GET /api/admin/regions — list regions with their countries (SRS FR-1.4).
// Read-only reference data — any staff role can read it (Phase 3 dashboard
// filters, campaign targets); only admin can write.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["regional_recruiter", "country_supervisor", "inhouse_supervisor", "director", "admin"]);
  if (guardRes) return guardRes;

  const regions = await prisma.region.findMany({
    include: { countries: { orderBy: { name: "asc" } } },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ data: regions });
}

// POST /api/admin/regions
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

  const parsed = createRegionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Validation failed", details: parsed.error.flatten().fieldErrors } },
      { status: 422 }
    );
  }

  const existing = await prisma.region.findUnique({ where: { name: parsed.data.name } });
  if (existing) {
    return NextResponse.json(
      { error: { code: "duplicate", message: "A region with this name already exists." } },
      { status: 409 }
    );
  }

  const region = await prisma.region.create({ data: parsed.data });
  return NextResponse.json({ data: region }, { status: 201 });
}
