import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireAuth } from "@/lib/api-auth";

// GET /api/payments/me — Candidate retrieves their payments
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAuth(user);
  if (guardRes) return guardRes;

  const payments = await prisma.payment.findMany({
    where: { user_id: user!.userId },
    include: {
      job: { select: { title: true } }
    },
    orderBy: { created_at: "desc" }
  });

  return NextResponse.json(payments);
}
