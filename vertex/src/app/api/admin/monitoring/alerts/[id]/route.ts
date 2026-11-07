import { NextRequest } from "next/server";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { readJson, seg } from "@/lib/pipeline";

// PATCH /api/admin/monitoring/alerts/:id {status, note}: an admin's review of
// one alert, open -> reviewing -> resolved or dismissed. FastAPI requires the
// note to close or reopen one, and records who and when on the audit trail.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;
  const read = await readJson(req);
  if (read.invalid) return read.invalid;
  const { id } = await params;
  return backendResponse(await callBackend(`/api/v1/monitoring/alerts/${seg(id)}`, { method: "PATCH", body: read.body }));
}
