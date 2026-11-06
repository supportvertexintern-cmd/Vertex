import { NextRequest } from "next/server";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { seg } from "@/lib/pipeline";

// POST /api/admin/deleted/:table/:id/restore: brings back a soft deleted record
// and what was deleted with it. Admin only. FastAPI re-checks it and audits it
// (vertex_be/app/api/v1/deleted.py).
export async function POST(req: NextRequest, { params }: { params: Promise<{ table: string; id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;

  const { table, id } = await params;
  return backendResponse(await callBackend(`/api/v1/deleted/${seg(table)}/${seg(id)}/restore`, { method: "POST" }));
}
