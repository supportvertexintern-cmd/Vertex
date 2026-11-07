import { NextRequest } from "next/server";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { clientHeaders } from "@/lib/auth-backend";
import { readJson, seg } from "@/lib/pipeline";

// POST /api/admin/users/:id/reactivate {reason}: sign-in works again. The
// account keeps its first activation, so a partner isn't welcomed twice
// (vertex_be/app/api/v1/users.py).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;
  const read = await readJson(req);
  if (read.invalid) return read.invalid;
  const { id } = await params;
  return backendResponse(
    await callBackend(`/api/v1/users/${seg(id)}/reactivate`, { method: "POST", body: read.body, forward: await clientHeaders(req) }),
  );
}
