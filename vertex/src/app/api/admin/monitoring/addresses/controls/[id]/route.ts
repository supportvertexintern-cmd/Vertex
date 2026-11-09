import { NextRequest } from "next/server";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { clientHeaders } from "@/lib/auth-backend";
import { readJson, seg } from "@/lib/pipeline";

// DELETE /api/admin/monitoring/addresses/controls/:id {reason}: ends a block
// or allow now. FastAPI keeps the row as history and records who and why.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;
  const read = await readJson(req);
  if (read.invalid) return read.invalid;
  const { id } = await params;
  return backendResponse(
    await callBackend(`/api/v1/monitoring/addresses/controls/${seg(id)}`, { method: "DELETE", body: read.body, forward: await clientHeaders(req) }),
  );
}
