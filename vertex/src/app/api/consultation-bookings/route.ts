import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { OPERATIONS_ROLES, FINANCE_ROLES } from "@/lib/rbac";

const VIEWER_ROLES = [...new Set([...OPERATIONS_ROLES, ...FINANCE_ROLES])];

// GET /api/consultation-bookings — Operations and Finance visibility into
// paid /consultation bookings, for reconciling the $50 Stripe charges
// against something in the CRM rather than only the Stripe dashboard. No
// server-side pagination/filtering — same convention as every other list
// endpoint in this app (client slices to 15 rows via usePagination), and
// booking volume here is inherently small.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, VIEWER_ROLES);
  if (guardRes) return guardRes;

  const bookings = await prisma.consultationBooking.findMany({
    orderBy: { created_at: "desc" },
  });

  return NextResponse.json({ data: bookings });
}
