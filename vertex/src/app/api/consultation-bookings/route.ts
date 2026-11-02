import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { OPERATIONS_ROLES, FINANCE_ROLES } from "@/lib/rbac";

const VIEWER_ROLES = [...new Set([...OPERATIONS_ROLES, ...FINANCE_ROLES])];

// GET /api/consultation-bookings — Operations and Finance visibility into
// paid /consultation bookings, for reconciling the $50 Stripe charges
// against something in the CRM rather than only the Stripe dashboard. No
// server-side pagination/filtering — the client slices to 15 rows via
// usePagination, and booking volume here is inherently small.
// Read from FastAPI since reads handover R6
// (vertex_be/app/api/v1/payment_reads.py).
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, VIEWER_ROLES);
  if (guardRes) return guardRes;

  return backendResponse(await callBackend("/api/v1/consultation-bookings"));
}
