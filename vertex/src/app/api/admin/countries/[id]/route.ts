import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";
import { updateCountrySchema } from "@/lib/validations";

// PATCH /api/admin/countries/:id — rename a country and/or move it to a
// different region.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;

  const { id } = await params;
  const existing = await prisma.country.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: { code: "not_found", message: "Country not found." } }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }

  const parsed = updateCountrySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Validation failed", details: parsed.error.flatten().fieldErrors } },
      { status: 422 }
    );
  }

  if (parsed.data.region_id) {
    const region = await prisma.region.findUnique({ where: { id: parsed.data.region_id } });
    if (!region) {
      return NextResponse.json({ error: { code: "not_found", message: "Region not found." } }, { status: 404 });
    }
  }

  if (parsed.data.name) {
    const duplicate = await prisma.country.findUnique({ where: { name: parsed.data.name } });
    if (duplicate && duplicate.id !== id) {
      return NextResponse.json(
        { error: { code: "duplicate", message: "A country with this name already exists." } },
        { status: 409 }
      );
    }
  }

  const country = await prisma.country.update({ where: { id }, data: parsed.data });
  return NextResponse.json({ data: country });
}

// DELETE /api/admin/countries/:id — most references (candidates,
// applications, staff assignment) SetNull rather than block; a partner
// candidate's chosen preferred/current-location country is a required
// field, though, so deleting a country still in use there is correctly
// rejected (Postgres FK constraint) rather than silently corrupting data.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;

  const { id } = await params;
  const existing = await prisma.country.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: { code: "not_found", message: "Country not found." } }, { status: 404 });
  }

  try {
    await prisma.country.delete({ where: { id } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
      return NextResponse.json(
        { error: { code: "in_use", message: "This country is still referenced by a partner candidate submission and can't be deleted." } },
        { status: 409 }
      );
    }
    throw err;
  }

  return NextResponse.json({ data: { id } });
}
