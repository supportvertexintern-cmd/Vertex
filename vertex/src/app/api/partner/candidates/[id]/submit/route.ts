import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { passOn, readJson, seg } from "@/lib/pipeline";

// POST /api/partner/candidates/:id/submit — a draft finished, upgraded in
// place against the same bar as a fresh submission, its documents moved to
// the new candidate. Written by FastAPI since the pipeline switch (step
// 6.7; vertex_be/app/api/v1/partner_submissions.py, submit_draft).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["partner", "hr", "operations_team", "operations_director", "admin"]);
  if (guardRes) return guardRes;
  const { id } = await params;
  const read = await readJson(req);
  if (read.invalid) return read.invalid;
  return passOn(`/api/v1/partner/candidates/${seg(id)}/submit`, { method: "POST", body: read.body });
}
