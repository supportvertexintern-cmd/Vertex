import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";
import { hashPassword, generateTemporaryPassword } from "@/lib/auth";
import { accountsOnFastApi } from "@/lib/flags";
import { passOn, seg } from "@/lib/pipeline";

// POST /api/admin/users/:id/reset-password — admin-triggered password
// reset, same one-time temp-password pattern as account creation: returned
// once in the response body, never stored/logged in plaintext.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;

  const { id } = await params;
  // FastAPI sets it since users step 8.3 (vertex_be/app/api/v1/users.py);
  // below is the way back, behind FLAG_ACCOUNTS_FASTAPI_ADMIN_USERS, until 8.5.
  if (accountsOnFastApi("ADMIN_USERS")) {
    return passOn(`/api/v1/users/${seg(id)}/reset-password`, { method: "POST" }, {
      unwrap: true,
      reshape: (data, body) => ({ data, temporaryPassword: body.temporaryPassword }),
    });
  }

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) {
    return NextResponse.json({ error: { code: "not_found", message: "User not found." } }, { status: 404 });
  }

  const temporaryPassword = generateTemporaryPassword();
  const password_hash = await hashPassword(temporaryPassword);

  await auditedPrisma(user!.userId).user.update({ where: { id }, data: { password_hash } });

  return NextResponse.json({ data: { id }, temporaryPassword });
}
