import { NextRequest } from "next/server";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { clientHeaders } from "@/lib/auth-backend";
import { readJson, seg } from "@/lib/pipeline";

// POST /api/admin/monitoring/accounts/:id/force-reset {reason}: clears a
// staff or partner login's password (every session ends), lifts any
// lockout and sends the setup email. FastAPI refuses candidates, the
// caller's own account and a deactivated one, and records it.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;
  const read = await readJson(req);
  if (read.invalid) return read.invalid;
  const { id } = await params;
  return backendResponse(
    await callBackend(`/api/v1/monitoring/accounts/${seg(id)}/force-reset`, { method: "POST", body: read.body, forward: await clientHeaders(req) }),
  );
}
