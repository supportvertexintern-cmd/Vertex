import { NextRequest } from "next/server";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { clientHeaders } from "@/lib/auth-backend";
import { seg } from "@/lib/pipeline";

// POST /api/admin/monitoring/locked/:fp/unlock: lifts the lock at once.
// FastAPI records who did it (login_unlocked), with the browser's address.
export async function POST(req: NextRequest, { params }: { params: Promise<{ fp: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;
  const { fp } = await params;
  return backendResponse(await callBackend(`/api/v1/monitoring/locked/${seg(fp)}/unlock`, { method: "POST", forward: await clientHeaders(req) }));
}
