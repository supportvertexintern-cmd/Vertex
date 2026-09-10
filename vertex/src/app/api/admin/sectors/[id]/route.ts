import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";

// DELETE /api/admin/sectors/:id
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;

  const { id } = await params;
  const sector = await prisma.sector.findUnique({ where: { id } });
  if (!sector) {
    return NextResponse.json({ error: { code: "not_found", message: "Sector not found." } }, { status: 404 });
  }

  await prisma.sector.delete({ where: { id } });
  return NextResponse.json({ data: { id } });
}
