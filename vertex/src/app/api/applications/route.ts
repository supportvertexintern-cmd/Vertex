import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, requireAuth } from "@/lib/api-auth";
import { callBackend, backendResponse } from "@/lib/backend";
import { pipelineResponse, readJson, queryOf } from "@/lib/pipeline";
import { isStaffRole } from "@/lib/rbac";
import { rateLimit, retryAfter } from "@/lib/rate-limit";
import { clientKey } from "@/lib/client-ip";
import { signCifUploadToken } from "@/lib/jwt";

// GET /api/applications — staff: the applications of the candidates they may
// see, newest first ({ data, total, page, pageSize }); anyone else: their
// own applications as a plain array, each with the document types it needs,
// or { applications: [] } without a candidate record.
// Read from FastAPI since reads handover R4
// (vertex_be/app/api/v1/pipeline_reads.py).
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAuth(user);
  if (guardRes) return guardRes;

  const result = await callBackend<unknown[] | null>("/api/v1/applications", { query: queryOf(req, ["page", "pageSize"]) });
  if (isStaffRole(user!.role) || !result.ok) return backendResponse(result);
  return NextResponse.json(result.body.data ?? { applications: [] });
}

// POST /api/applications — the Candidate Information Form: the first thing
// anyone fills in, anonymously, as a signed-in candidate, or as staff for a
// lead. Written by FastAPI since the pipeline switch (step 6.7;
// vertex_be/app/api/v1/applications.py, submit), which creates the
// candidate if needed, screens a self-applicant and lists the emails due.
// This app keeps limiting anonymous submissions, and signs the short-lived
// upload token that lets a self-applicant who passed screening attach
// documents before any account exists (FastAPI issues no tokens).
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const read = await readJson(req, true);
  if (read.invalid) return read.invalid;

  if (!user) {
    const ip = clientKey(req.headers);
    const rl = await rateLimit(`applications-new:${ip}`, { max: 5, windowMs: 60_000 });
    if (!rl.success) {
      return NextResponse.json({ error: "Too many submissions. Please try again later." }, { status: 429, headers: { "Retry-After": retryAfter(rl) } });
    }
  }

  // An anonymous applicant has no session: FastAPI is called as this app,
  // with the user's session whenever there is one.
  const result = await callBackend("/api/v1/applications/submit", { method: "POST", body: read.body, asUser: "if-signed-in" });
  if (!result.ok && result.status === 402 && result.error.details) {
    // The form reads these to send the candidate to pay.
    return NextResponse.json({ error: result.error.message, ...(result.error.details as object) }, { status: 402 });
  }
  return pipelineResponse(result, {
    unwrap: true,
    legacyErrors: true,
    reshape: (data, body) => {
      const application = data as { candidate_id: string };
      const uploadToken = body.screening_passed ? signCifUploadToken(application.candidate_id) : undefined;
      return { ...application, upload_token: uploadToken };
    },
  });
}
