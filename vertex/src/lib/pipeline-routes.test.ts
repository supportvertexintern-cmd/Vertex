import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The candidate pipeline is written by FastAPI since the switch (step 6.7):
// each route checks what it can early and passes the request on, then sends
// the emails FastAPI lists (owner's decision D1). FastAPI's rules are tested
// in vertex_be/tests; e2e/*.spec.ts goes through the real FastAPI.

const state = vi.hoisted(() => ({ role: "operations_team" as string | null, sent: [] as unknown[][] }));

vi.mock("@/lib/api-auth", () => {
  const deny = (status: number) => Response.json({ error: "denied" }, { status });
  return {
    getAuthUser: async () => (state.role ? { userId: "u1", email: "u@test.invalid", role: state.role, sid: "s", ver: 0 } : null),
    requireRole: (user: { role: string } | null, roles: readonly string[]) => (!user ? deny(401) : roles.includes(user.role) ? null : deny(403)),
    requireAuth: (user: unknown) => (user ? null : deny(401)),
    forbidden: (body: unknown) => Response.json(body, { status: 403 }),
  };
});

const callBackend = vi.fn();
vi.mock("@/lib/backend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/backend")>()),
  callBackend: (...args: unknown[]) => callBackend(...args),
}));

// Emails are recorded, and sent at once instead of after the response.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (fn: () => unknown) => fn(),
}));
vi.mock("@/lib/email", () => {
  const senders = [
    "sendCandidateInviteEmail", "sendReferralCommissionEarnedEmail", "sendReferralCommissionApprovedEmail", "sendReferralCommissionPaidEmail",
    "sendCandidateMessageNotificationEmail", "sendApplicationConfirmationEmail", "sendStatusUpdateEmail", "sendCandidateApprovedEmail",
    "sendCaseStageUpdateEmail", "sendPartnerCaseStageUpdateEmail", "sendCaseRejectedEmail", "sendPartnerCaseRejectedEmail",
    "sendCaseReminderEmail", "sendPartnerCandidateSubmittedEmail", "sendPartnerCaseCreatedEmail", "sendPartnerCandidateRejectedEmail",
  ];
  return Object.fromEntries(senders.map((name) => [name, async (...args: unknown[]) => void state.sent.push([name, ...args])]));
});

const alerts = vi.hoisted(() => ({ malware: vi.fn(), scanner: vi.fn() }));
vi.mock("@/lib/security-monitor", () => ({ onMalwareFound: alerts.malware, onScannerUnavailable: alerts.scanner }));

import { NOTICE_SENDERS, sendNotices } from "@/lib/pipeline";
import * as stage from "@/app/api/cases/[id]/stage/route";
import * as remind from "@/app/api/cases/[id]/remind/route";
import * as sign from "@/app/api/cases/[id]/contract/sign/route";
import * as candidateStatus from "@/app/api/candidates/[id]/status/route";
import * as profile from "@/app/api/candidates/profile/route";
import * as messages from "@/app/api/candidates/[id]/messages/route";
import * as applications from "@/app/api/applications/route";
import * as upload from "@/app/api/upload/route";
import * as partnerDraft from "@/app/api/partner/candidates/[id]/route";
import * as createCase from "@/app/api/partner-candidates/[id]/create-case/route";
import * as exceptionsRoute from "@/app/api/exceptions/route";
import * as approve from "@/app/api/admin/referral-commissions/[id]/approve/route";

const req = (method: string, body?: string, headers: Record<string, string> = {}, url = "http://localhost/api/x") =>
  new NextRequest(url, { method, body, headers: body ? { "content-type": "application/json", ...headers } : headers });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const ok = (data: unknown, extra: Record<string, unknown> = {}, status = 200) => ({ ok: true, status, body: { data, ...extra } });

beforeEach(() => {
  state.role = "operations_team";
  state.sent = [];
  callBackend.mockReset();
  callBackend.mockResolvedValue(ok({ id: "x1" }));
  alerts.malware.mockReset();
  alerts.scanner.mockReset();
  vi.unstubAllEnvs();
});

describe("passes each write on to FastAPI", () => {
  it.each([
    ["stage", () => stage.PATCH(req("PATCH", '{"stage":"permit_processing_followup"}'), params("c/1")), ["/api/v1/cases/c%2F1/stage", { method: "PATCH", body: { stage: "permit_processing_followup" } }]],
    ["remind", () => remind.POST(req("POST", '{"channel":"document"}'), params("c1")), ["/api/v1/cases/c1/remind", { method: "POST", body: { channel: "document" } }]],
    ["exception", () => exceptionsRoute.POST(req("POST", "{}")), ["/api/v1/exceptions", { method: "POST", body: {} }]],
  ])("%s", async (_name, call, expected) => {
    state.role = "admin";
    await call();
    expect(callBackend).toHaveBeenCalledWith(...expected);
  });

  it("refuses early, without calling FastAPI", async () => {
    state.role = "regional_recruiter";
    expect((await stage.PATCH(req("PATCH", "{}"), params("c1"))).status).toBe(403);
    expect((await approve.POST(req("POST"), params("rc1"))).status).toBe(403);
    expect((await createCase.PATCH(req("PATCH"), params("pc1"))).status).toBe(403);
    state.role = null;
    expect((await messages.POST(req("POST", "{}"), params("c1"))).status).toBe(401);
    expect(callBackend).not.toHaveBeenCalled();
  });

  it("refuses a body that isn't JSON", async () => {
    expect((await candidateStatus.PATCH(req("PATCH", "{nope"), params("c1"))).status).toBe(403); // not a status setter
    state.role = "admin";
    const res = await candidateStatus.PATCH(req("PATCH", "{nope"), params("c1"));
    expect([res.status, await res.json()]).toEqual([400, { error: { code: "invalid_json", message: "Invalid JSON" } }]);
    expect(callBackend).not.toHaveBeenCalled();
  });
});

describe("answers in each route's own shape", () => {
  it("FastAPI's envelope by default", async () => {
    const error = { code: "case_rejected", message: "This case has been rejected and is closed." };
    callBackend.mockResolvedValueOnce({ ok: false, status: 422, error });
    const res = await createCase.PATCH(req("PATCH"), params("pc1"));
    expect(res.status).toBe(403); // ops aren't HR
    state.role = "hr";
    callBackend.mockResolvedValueOnce({ ok: false, status: 422, error });
    const res2 = await createCase.PATCH(req("PATCH"), params("pc1"));
    expect([res2.status, await res2.json()]).toEqual([422, { error }]);
  });

  it("the older string errors where pages read them", async () => {
    callBackend.mockResolvedValueOnce({ ok: false, status: 422, error: { code: "awaiting_ops_review", message: "Awaiting review." } });
    const res = await stage.PATCH(req("PATCH", "{}"), params("c1"));
    expect([res.status, await res.json()]).toEqual([422, { error: "Awaiting review." }]);
  });

  it("the candidate's profile unwrapped", async () => {
    state.role = "candidate";
    callBackend.mockResolvedValueOnce(ok({ id: "cand1", nationality: "Kenyan" }));
    const res = await profile.PUT(req("PUT", '{"nationality":"Kenyan"}'));
    expect(await res.json()).toEqual({ id: "cand1", nationality: "Kenyan" });
  });

  it("an abandoned draft as a message", async () => {
    state.role = "partner";
    callBackend.mockResolvedValueOnce(ok({ id: "pc1" }));
    const res = await partnerDraft.DELETE(req("DELETE"), params("pc1"));
    expect(await res.json()).toEqual({ message: "Draft deleted." });
  });
});

describe("sends the emails FastAPI lists", () => {
  it("after the write, with this app's own URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://vertex.example");
    callBackend.mockResolvedValueOnce(
      ok({ id: "m1" }, { notify: [{ kind: "candidate_message", email: "r@test.invalid", full_name: "Rec", view_path: "/recruiter/candidates/c1" }] }, 201),
    );
    state.role = "candidate";
    const res = await messages.POST(req("POST", '{"body":"Hi"}'), params("c1"));
    expect(await res.json()).toEqual({ data: { id: "m1" } }); // notify isn't passed on
    expect(state.sent).toEqual([["sendCandidateMessageNotificationEmail", "r@test.invalid", "Rec", "https://vertex.example/recruiter/candidates/c1"]]);
  });

  it("one per notice, and a failure or an unknown kind doesn't stop the rest", async () => {
    await sendNotices([
      { kind: "no_such_email" },
      { kind: "case_reminder", email: "p@test.invalid", recipient_name: "Pat", candidate_name: "Abebe", programme_title: "Care", channel: "payment", message: null },
      { kind: "partner_case_created", email: "p@test.invalid", partner_name: "Agency", candidate_name: "Abebe" },
    ]);
    expect(state.sent).toEqual([
      ["sendCaseReminderEmail", "p@test.invalid", "Pat", "Abebe", "Care", "payment", undefined],
      ["sendPartnerCaseCreatedEmail", "p@test.invalid", "Agency", "Abebe"],
    ]);
  });

  it("has a sender for every kind", () => {
    expect(Object.keys(NOTICE_SENDERS)).toHaveLength(22); // vertex_be/tests/test_notices.py matches them with FastAPI's
  });
});

describe("the application form", () => {
  it("anonymous: the session only if there is one, and an upload token after a pass", async () => {
    vi.stubEnv("JWT_SECRET", "test-only-signing-value-not-a-real-secret-pipeline");
    state.role = null;
    callBackend.mockResolvedValueOnce(ok({ id: "a1", candidate_id: "cand1" }, { screening_passed: true, notify: [] }, 201));
    const res = await applications.POST(req("POST", "{}", { "x-forwarded-for": "198.51.100.7" }));
    expect(callBackend).toHaveBeenCalledWith("/api/v1/applications/submit", { method: "POST", body: {}, asUser: "if-signed-in" });
    const body = await res.json();
    expect([res.status, body.id, typeof body.upload_token]).toEqual([201, "a1", "string"]);
  });

  it("no upload token when screening didn't pass, and the fee answer the form reads", async () => {
    state.role = "candidate";
    callBackend.mockResolvedValueOnce(ok({ id: "a1", candidate_id: "cand1" }, { screening_passed: false }, 201));
    expect((await (await applications.POST(req("POST", "{}"))).json()).upload_token).toBeUndefined();
    callBackend.mockResolvedValueOnce({
      ok: false, status: 402, error: { code: "payment_required", message: "Pay first.", details: { requiresPayment: true, jobId: "j1" } },
    });
    const fee = await applications.POST(req("POST", "{}"));
    expect([fee.status, await fee.json()]).toEqual([402, { error: "Pay first.", requiresPayment: true, jobId: "j1" }]);
  });
});

describe("uploads", () => {
  const form = (headers: Record<string, string> = {}, query = "?type=passport") =>
    new NextRequest(`http://localhost/api/upload${query}`, {
      method: "POST",
      body: "--b\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.pdf\"\r\n\r\n%PDF-1.4\r\n--b--\r\n",
      headers: { "content-type": "multipart/form-data; boundary=b", ...headers },
    });

  it("a signed-in upload goes as the user, answered as before", async () => {
    state.role = "candidate";
    callBackend.mockResolvedValueOnce(ok({ id: "d1", scan_status: "clean" }));
    const res = await upload.POST(form());
    const [path, call] = callBackend.mock.calls[0];
    expect([path, call.query.type, call.raw.contentType, call.asUser]).toEqual(["/api/v1/documents", "passport", "multipart/form-data; boundary=b", undefined]);
    expect(await res.json()).toEqual({ documentId: "d1", message: "File uploaded successfully." });
  });

  it("the form's upload goes as this app, with its token", async () => {
    state.role = null;
    callBackend.mockResolvedValueOnce(ok({ id: "d2", scan_status: "clean" }));
    await upload.POST(form({ "X-Upload-Token": "tok" }, "?type=passport&candidate_id=cand1"));
    const [path, call] = callBackend.mock.calls[0];
    expect([path, call.asUser, call.forward, call.query.candidate_id]).toEqual(["/api/v1/documents/form-upload", false, { "X-Upload-Token": "tok" }, "cand1"]);
  });

  it("without a session or token it's 401; without multipart it's 400", async () => {
    state.role = null;
    expect((await upload.POST(form())).status).toBe(401);
    state.role = "candidate";
    expect((await upload.POST(req("POST", "{}"))).status).toBe(400);
    expect(callBackend).not.toHaveBeenCalled();
  });

  it("malware and an unscanned upload raise this app's alerts", async () => {
    state.role = "candidate";
    callBackend.mockResolvedValueOnce({ ok: false, status: 422, error: { code: "malware_detected", message: "Rejected.", details: { signature: "Eicar" } } });
    const res = await upload.POST(form());
    expect([res.status, await res.json()]).toEqual([422, { error: "Rejected." }]);
    expect(alerts.malware).toHaveBeenCalledWith("malware_rejected", "own-profile", "u1", "Eicar");
    vi.stubEnv("CLAMD_HOST", "clamd");
    callBackend.mockResolvedValueOnce(ok({ id: "d3", scan_status: "unscanned" }));
    await upload.POST(form());
    expect(alerts.scanner).toHaveBeenCalledTimes(1);
  });
});

describe("signing a contract", () => {
  it("passes the browser's address on", async () => {
    state.role = "candidate";
    await sign.POST(req("POST", '{"signed_by_name":"Abebe"}', { "x-forwarded-for": "203.0.113.9" }), params("c1"));
    expect(callBackend).toHaveBeenCalledWith("/api/v1/cases/c1/contract/sign", {
      method: "POST",
      body: { signed_by_name: "Abebe" },
      forward: { "X-Forwarded-For": "203.0.113.9" },
    });
  });
});
