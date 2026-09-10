import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";

// DELETE /api/admin/document-types/:id — blocked if any real uploaded
// Document still references this type (Restrict); a country's requirement
// list referencing it is cleaned up automatically (Cascade) since that's
// just a membership flag, not real candidate data.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;

  const { id } = await params;
  const existing = await prisma.documentRequirementType.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: { code: "not_found", message: "Document type not found." } }, { status: 404 });
  }

  const db = auditedPrisma(user!.userId);
  try {
    await db.documentRequirementType.delete({ where: { id } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
      return NextResponse.json(
        { error: { code: "in_use", message: "This document type is still referenced by an uploaded document and can't be deleted." } },
        { status: 409 }
      );
    }
    throw err;
  }

  return NextResponse.json({ data: { id } });
}
