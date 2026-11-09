import { NextRequest } from "next/server";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { readJson, seg } from "@/lib/pipeline";

// POST /api/admin/monitoring/lockouts/:id/review {note}: closes "Needs
// review" on a 24-hour lockout. FastAPI requires the note and audits it.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;
  const read = await readJson(req);
  if (read.invalid) return read.invalid;
  const { id } = await params;
  return backendResponse(await callBackend(`/api/v1/monitoring/lockouts/${seg(id)}/review`, { method: "POST", body: read.body }));
}
