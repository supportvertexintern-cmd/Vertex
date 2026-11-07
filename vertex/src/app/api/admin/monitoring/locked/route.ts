import { NextRequest } from "next/server";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";

// GET /api/admin/monitoring/locked: Admin → Monitoring → Locked Accounts
// (2026-11-07): the accounts the per-account sign-in limit holds now (10
// failed sign-ins in 15 minutes). Admins only (vertex_be/app/api/v1/monitoring.py).
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;
  return backendResponse(await callBackend("/api/v1/monitoring/locked"));
}
