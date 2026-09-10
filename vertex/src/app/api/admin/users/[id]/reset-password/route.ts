import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";
import { hashPassword, generateTemporaryPassword } from "@/lib/auth";

// POST /api/admin/users/:id/reset-password — admin-triggered password
// reset, same one-time temp-password pattern as account creation: returned
// once in the response body, never stored/logged in plaintext.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;

  const { id } = await params;
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) {
    return NextResponse.json({ error: { code: "not_found", message: "User not found." } }, { status: 404 });
  }

  const temporaryPassword = generateTemporaryPassword();
  const password_hash = await hashPassword(temporaryPassword);

  await auditedPrisma(user!.userId).user.update({ where: { id }, data: { password_hash } });

  return NextResponse.json({ data: { id }, temporaryPassword });
}
