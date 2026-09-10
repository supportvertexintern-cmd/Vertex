import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";
import { updateRegionSchema } from "@/lib/validations";

// PATCH /api/admin/regions/:id — rename a region.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;

  const { id } = await params;
  const existing = await prisma.region.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: { code: "not_found", message: "Region not found." } }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }

  const parsed = updateRegionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Validation failed", details: parsed.error.flatten().fieldErrors } },
      { status: 422 }
    );
  }

  const duplicate = await prisma.region.findUnique({ where: { name: parsed.data.name } });
  if (duplicate && duplicate.id !== id) {
    return NextResponse.json(
      { error: { code: "duplicate", message: "A region with this name already exists." } },
      { status: 409 }
    );
  }

  const region = await prisma.region.update({ where: { id }, data: parsed.data });
  return NextResponse.json({ data: region });
}
