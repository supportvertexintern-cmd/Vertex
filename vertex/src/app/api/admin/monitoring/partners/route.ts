import { NextRequest } from "next/server";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { queryOf } from "@/lib/pipeline";
import { PARTNER_FILTERS } from "@/lib/monitoring";

// Admin → Monitoring → Partners & Logins (phase 3, 2026-11-07): one row per
// agency, with who added it and its login's status and latest sign-in.
// FastAPI filters and pages it, admins only (vertex_be/app/api/v1/monitoring.py).

// GET /api/admin/monitoring/partners?q=&country=&status=&login_status=&created_from=&created_to=&created_by=&page=&pageSize=
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;
  return backendResponse(await callBackend("/api/v1/monitoring/partners", { query: queryOf(req, [...PARTNER_FILTERS, "page", "pageSize"]) }));
}
