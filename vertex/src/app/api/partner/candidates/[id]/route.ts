import { NextRequest } from "next/server";
import { passOn, readJson, seg } from "@/lib/pipeline";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";

// GET /api/partner/candidates/:id — one of the partner's own submissions.
// Read from FastAPI since reads handover R4
// (vertex_be/app/api/v1/pipeline_reads.py).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["partner"]);
  if (guardRes) return guardRes;

  const { id } = await params;
  return backendResponse(await callBackend(`/api/v1/partner/candidates/${seg(id)}`));
}

// PATCH /api/partner/candidates/:id — a partner correcting its own
// submission, or staff re-saving a draft they're entering; a bridged
// submission's candidate and application follow. Written by FastAPI since
// the pipeline switch (step 6.7; vertex_be/app/api/v1/partner_submissions.py).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["partner", "hr", "operations_team", "operations_director", "admin"]);
  if (guardRes) return guardRes;
  const { id } = await params;
  const read = await readJson(req);
  if (read.invalid) return read.invalid;
  return passOn(`/api/v1/partner/candidates/${seg(id)}`, { method: "PATCH", body: read.body });
}

// DELETE /api/partner/candidates/:id — a partner abandoning its own
// unfinished draft, with its files (FastAPI, as above). Answered as before.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["partner"]);
  if (guardRes) return guardRes;
  const { id } = await params;
  return passOn(`/api/v1/partner/candidates/${seg(id)}`, { method: "DELETE" }, { unwrap: true, reshape: () => ({ message: "Draft deleted." }) });
}
