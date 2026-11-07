import { NextRequest } from "next/server";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { clientHeaders } from "@/lib/auth-backend";
import { seg } from "@/lib/pipeline";

// GET /api/admin/monitoring/accounts/:id: one account, its live sessions and
// its sign-in history. FastAPI records the view on the audit trail, with the
// browser's address.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;
  const { id } = await params;
  return backendResponse(await callBackend(`/api/v1/monitoring/accounts/${seg(id)}`, { forward: await clientHeaders(req) }));
}
