import { NextRequest } from "next/server";
import { passOn, readJson, seg } from "@/lib/pipeline";
import { getAuthUser, requireAuth } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";

// GET /api/candidates/:id/messages — the candidate's thread, oldest first,
// for those on it: the candidate, their recruiter, admin, the sourcing
// partner, and HR, operations and director staff on a partner-sourced or
// self-submitted candidate.
// Read from FastAPI since reads handover R4
// (vertex_be/app/api/v1/pipeline_reads.py).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireAuth(user);
  if (guardRes) return guardRes;

  const { id } = await params;
  return backendResponse(await callBackend(`/api/v1/candidates/${seg(id)}/messages`));
}

// POST /api/candidates/:id/messages — written by FastAPI since the pipeline
// switch (step 6.7; vertex_be/app/api/v1/candidates.py, post_message),
// with the same thread access as GET. It tells whichever side didn't send
// the message; this app sends that email.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireAuth(user);
  if (guardRes) return guardRes;
  const { id } = await params;
  const read = await readJson(req);
  if (read.invalid) return read.invalid;
  return passOn(`/api/v1/candidates/${seg(id)}/messages`, { method: "POST", body: read.body });
}
