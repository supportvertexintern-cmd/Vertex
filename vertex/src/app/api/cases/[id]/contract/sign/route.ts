import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { passOn, readJson, seg } from "@/lib/pipeline";

// POST /api/cases/:id/contract/sign — the candidate signs their own contract
// (SRS FR-4.3): a simple electronic signature (typed legal name, session,
// time and address). Written by FastAPI since the pipeline switch (step
// 6.7; vertex_be/app/api/v1/cases.py, sign_contract), which sees this
// app's connection, so the browser's address is passed on.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["candidate"]);
  if (guardRes) return guardRes;
  const read = await readJson(req, true);
  if (read.invalid) return read.invalid;
  return passOn(`/api/v1/cases/${seg(id)}/contract/sign`, { method: "POST", body: read.body, forward: { "X-Forwarded-For": req.headers.get("x-forwarded-for") } }, { legacyErrors: true });
}
