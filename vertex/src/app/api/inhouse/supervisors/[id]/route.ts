import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { seg } from "@/lib/pipeline";

// GET /api/inhouse/supervisors/:id — one Country Supervisor's summary,
// scoped to the caller's assigned countries.
// Read from FastAPI since reads handover R3 (vertex_be/app/api/v1/dashboards.py).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["inhouse_supervisor", "admin"]);
  if (guardRes) return guardRes;
  const { id } = await params;

  return backendResponse(await callBackend(`/api/v1/inhouse/supervisors/${seg(id)}`));
}
