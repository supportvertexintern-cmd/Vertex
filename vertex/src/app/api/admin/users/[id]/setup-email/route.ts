import { NextRequest } from "next/server";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { seg } from "@/lib/pipeline";

// POST /api/admin/users/:id/setup-email: the account setup email again, for
// a staff or partner login that hasn't set its password. FastAPI sends it
// (vertex_be/app/api/v1/users.py).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;
  const { id } = await params;
  return backendResponse(await callBackend(`/api/v1/users/${seg(id)}/setup-email`, { method: "POST" }));
}
