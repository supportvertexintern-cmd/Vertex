import { NextRequest } from "next/server";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { queryOf } from "@/lib/pipeline";
import { LOCKOUT_FILTERS } from "@/lib/monitoring";

// Admin → Monitoring → Locked Accounts → History (login protection, 4.1):
// every lockout within the retention window, filtered and paged by FastAPI.

// GET /api/admin/monitoring/lockouts?q=&step=&ended_by=&needs_review=&date_from=&date_to=&page=&pageSize=
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;
  return backendResponse(await callBackend("/api/v1/monitoring/lockouts", { query: queryOf(req, [...LOCKOUT_FILTERS, "page", "pageSize"]) }));
}
