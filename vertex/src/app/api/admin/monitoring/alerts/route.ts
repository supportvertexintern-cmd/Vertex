import { NextRequest } from "next/server";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";

// Admin → Monitoring → Suspicious Activity (phase 2, 2026-11-07): every
// alert the security monitor raised, newest first. FastAPI filters and pages
// it, and checks the caller is an admin (vertex_be/app/api/v1/monitoring.py).
const KEYS = ["status", "severity", "rule", "user_id", "date_from", "date_to", "page", "pageSize"] as const;

// GET /api/admin/monitoring/alerts?status=open&status=reviewing&severity=&rule=&user_id=&date_from=&date_to=&page=&pageSize=
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;
  // status may repeat, so the query is passed on as it came (known keys only).
  const query = new URLSearchParams();
  for (const key of KEYS) for (const value of req.nextUrl.searchParams.getAll(key)) if (value) query.append(key, value);
  const suffix = query.size ? `?${query}` : "";
  return backendResponse(await callBackend(`/api/v1/monitoring/alerts${suffix}`));
}
