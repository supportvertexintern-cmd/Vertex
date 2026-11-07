import { NextRequest } from "next/server";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { clientHeaders } from "@/lib/auth-backend";
import { readJson, seg } from "@/lib/pipeline";

// POST /api/admin/users/:id/deactivate {reason}: blocks the account without
// deleting it. Its sessions end at once; no sign-in, refresh, setup or reset
// link works until it is reactivated. FastAPI refuses the caller's own
// account and the last active admin (vertex_be/app/api/v1/users.py).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;
  const read = await readJson(req);
  if (read.invalid) return read.invalid;
  const { id } = await params;
  return backendResponse(
    await callBackend(`/api/v1/users/${seg(id)}/deactivate`, { method: "POST", body: read.body, forward: await clientHeaders(req) }),
  );
}
