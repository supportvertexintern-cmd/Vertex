import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, requireAuth } from "@/lib/api-auth";
import { callBackend } from "@/lib/backend";
import { clientKey } from "@/lib/client-ip";
import { limitedResponse, rateLimit } from "@/lib/rate-limit";
import { appPreflight, appResponse } from "@/lib/app-auth";

// POST /api/upload?type=<key>[&candidate_id=...|&partner_candidate_id=...]
// Documents are FastAPI's since the pipeline switch (step 6.7; owner's
// decision D2): it checks the file by its bytes, scans it, stores it and
// writes the row (vertex_be/app/api/v1/documents.py). This route passes
// the multipart body on as it came and answers in its older shape.
//
// Four callers: a signed-in candidate for themself; staff, partners, HR,
// operations or finance for a candidate they can reach, or a partner (or
// HR/operations) to a draft; an anonymous self-applicant attaching
// documents to the form they've just submitted, whose X-Upload-Token
// FastAPI verifies (/documents/form-upload); and, with ?intake=1, the
// Candidate Information Form uploading its files before it's submitted
// (2026-10-24): anyone, rate-limited by address. FastAPI stores the file
// with no owner and answers with the receipt the application presents
// (/documents/intake). Both anonymous paths call FastAPI as this app.
const UPLOAD_TIMEOUT_MS = 60_000; // the scan comes first
// Upstream's limit: enough for a long checklist and a few retries. Closed
// when the limiter's store is down: anyone can call it, and it stores files.
const INTAKE_LIMIT = { max: 30, windowMs: 10 * 60_000, failClosed: true };
const INTAKE_LIMITED = "Too many uploads. Please wait a few minutes and try again.";

export async function POST(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const uploadToken = req.headers.get("X-Upload-Token");
  const candidateId = params.get("candidate_id");
  const fromForm = Boolean(uploadToken && candidateId);
  const intake = params.get("intake") === "1";

  if (intake) {
    const rl = await rateLimit(`upload-intake:${clientKey(req.headers)}`, INTAKE_LIMIT);
    if (!rl.success) return forApp(req, limitedResponse(rl, { error: INTAKE_LIMITED }));
  } else if (!fromForm) {
    const guardRes = requireAuth(await getAuthUser(req));
    if (guardRes) return guardRes;
  }

  const contentType = req.headers.get("content-type");
  if (!contentType?.toLowerCase().startsWith("multipart/form-data")) {
    const invalid = NextResponse.json({ error: "Invalid form data." }, { status: 400 });
    return intake ? forApp(req, invalid) : invalid;
  }
  const raw = { body: await req.arrayBuffer(), contentType };
  const query = {
    type: params.get("type") ?? undefined,
    candidate_id: candidateId ?? undefined,
    partner_candidate_id: params.get("partner_candidate_id") ?? undefined,
  };

  if (intake) {
    const receipt = await callBackend("/api/v1/documents/intake", {
      method: "POST", raw, query: { type: query.type }, asUser: false, timeoutMs: UPLOAD_TIMEOUT_MS,
    });
    if (!receipt.ok) return forApp(req, NextResponse.json({ error: receipt.error.message }, { status: receipt.status }));
    const { id, intake_token } = receipt.body.data as { id: string; intake_token: string };
    return forApp(req, NextResponse.json({ documentId: id, intake_token }));
  }

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

// The mobile app's intake uploads (a recruiter's Candidate Information Form):
// the Flutter web build calls from its own origin, so ?intake=1 answers carry
// the app's CORS headers (lib/app-auth.ts: APP_ORIGINS only, no credentials).
// Native apps send no Origin. The other uploads need the website's session
// cookie and stay same-origin.
const forApp = (req: NextRequest, res: Response) => appResponse(req, res instanceof NextResponse ? res : new NextResponse(res.body, res));

export function OPTIONS(req: NextRequest) {
  return appPreflight(req);
}
