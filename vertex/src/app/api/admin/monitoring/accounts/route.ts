import { NextRequest } from "next/server";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { queryOf } from "@/lib/pipeline";

// Admin → Monitoring → User Accounts (phase 1, 2026-11-07): every login but
// candidates', with its status, who created it, its latest sign-in and its
// live sessions. FastAPI filters, sorts and pages it, and checks the caller
// is an admin (vertex_be/app/api/v1/monitoring.py).
const QUERY = ["q", "role", "status", "created_from", "created_to", "inactive_days", "flagged", "sort", "direction", "page", "pageSize"] as const;

// GET /api/admin/monitoring/accounts?q=&role=&status=&created_from=&created_to=&inactive_days=&sort=&direction=&page=&pageSize=
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;
  return backendResponse(await callBackend("/api/v1/monitoring/accounts", { query: queryOf(req, QUERY) }));
}
