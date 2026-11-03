import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, requireAuth } from "@/lib/api-auth";
import { callBackend } from "@/lib/backend";

// POST /api/upload?type=<key>[&candidate_id=...|&partner_candidate_id=...]
// Documents are FastAPI's since the pipeline switch (step 6.7; owner's
// decision D2): it checks the file by its bytes, scans it, stores it and
// writes the row (vertex_be/app/api/v1/documents.py). This route passes
// the multipart body on as it came and answers in its older shape.
//
// Three callers, as before: a signed-in candidate for themself; staff,
// partners, HR, operations or finance for a candidate they can reach, or a
// partner (or HR/operations) to a draft; and an anonymous self-applicant
// attaching documents to the form they've just submitted, whose
// X-Upload-Token FastAPI verifies (/documents/form-upload, called as this
// app: there's no session).
const UPLOAD_TIMEOUT_MS = 60_000; // the scan comes first

export async function POST(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const uploadToken = req.headers.get("X-Upload-Token");
  const candidateId = params.get("candidate_id");
  const fromForm = Boolean(uploadToken && candidateId);

  if (!fromForm) {
    const guardRes = requireAuth(await getAuthUser(req));
    if (guardRes) return guardRes;
  }

  const contentType = req.headers.get("content-type");
  if (!contentType?.toLowerCase().startsWith("multipart/form-data")) {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }
  const raw = { body: await req.arrayBuffer(), contentType };
  const query = {
    type: params.get("type") ?? undefined,
    candidate_id: candidateId ?? undefined,
    partner_candidate_id: params.get("partner_candidate_id") ?? undefined,
  };

  const result = fromForm
    ? await callBackend("/api/v1/documents/form-upload", {
        method: "POST", raw, query, asUser: false, forward: { "X-Upload-Token": uploadToken }, timeoutMs: UPLOAD_TIMEOUT_MS,
      })
    : await callBackend("/api/v1/documents", { method: "POST", raw, query, timeoutMs: UPLOAD_TIMEOUT_MS });

  // FastAPI records a rejected or unscanned upload and raises the alert
  // (since reads handover R7a, vertex_be/app/services/security_monitor.py).
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: result.status });
  const document = result.body.data as { id: string; scan_status: string };
  return NextResponse.json({ documentId: document.id, message: "File uploaded successfully." });
}
