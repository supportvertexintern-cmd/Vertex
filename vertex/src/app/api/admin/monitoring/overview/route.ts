import { NextRequest } from "next/server";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";

// GET /api/admin/monitoring/overview: Admin → Monitoring → Security Overview
// (phase 5, 2026-11-07): counts for the last 24 hours and 7 days, and the
// latest alerts. Admins only (vertex_be/app/api/v1/monitoring.py).
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;
  return backendResponse(await callBackend("/api/v1/monitoring/overview"));
}
