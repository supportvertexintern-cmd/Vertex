import { NextRequest } from "next/server";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";

// GET /api/admin/deleted?table=&limit=: soft deleted records, newest first.
// Admin only. FastAPI re-checks it (vertex_be/app/api/v1/deleted.py).
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;

  const params = req.nextUrl.searchParams;
  const query = { table: params.get("table") ?? undefined, limit: params.get("limit") ?? undefined };
  return backendResponse(await callBackend("/api/v1/deleted", { query }));
}
