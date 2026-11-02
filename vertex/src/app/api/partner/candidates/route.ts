import { NextRequest } from "next/server";
import { passOn, readJson } from "@/lib/pipeline";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";

// GET /api/partner/candidates — the partner's own submissions, newest first,
// each flagged when a document was rejected or the last message came from
// Vertex's side, with the count needing attention.
// Read from FastAPI since reads handover R4
// (vertex_be/app/api/v1/pipeline_reads.py).
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["partner"]);
  if (guardRes) return guardRes;

  return backendResponse(await callBackend("/api/v1/partner/candidates"));
}

// POST /api/partner/candidates — a partner submitting a candidate (SRS
// FR-5.1), or HR, operations or admin entering a partner's backlog for it
// (naming partner_id). Written by FastAPI since the pipeline switch (step
// 6.7; vertex_be/app/api/v1/partner_submissions.py): the checks, then the
// Candidate, Application and bridged submission in one transaction.
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["partner", "hr", "operations_team", "operations_director", "admin"]);
  if (guardRes) return guardRes;
  const read = await readJson(req);
  if (read.invalid) return read.invalid;
  return passOn("/api/v1/partner/candidates", { method: "POST", body: read.body });
}
