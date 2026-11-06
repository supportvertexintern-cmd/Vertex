// The partner and referral agent routes since users step 8.4: FastAPI writes
// (vertex_be/tests/test_partner_agencies.py, test_referral_agent_accounts.py)
// and these routes keep the roles, the rate limits, the response shapes and
// the emails FastAPI lists.
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  process.env.JWT_SECRET ??= "test-only-signing-value-not-a-real-secret-partners";
  return {
    user: null as null | { userId: string; email: string; role: string; sid: string; ver: number },
  };
});

const callBackend = vi.fn();
vi.mock("@/lib/backend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/backend")>()),
  callBackend: (...args: unknown[]) => callBackend(...args),
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (fn: () => unknown) => fn(),
}));
vi.mock("@/lib/audit", () => ({ recordSecurityEvent: async () => undefined }));
vi.mock("@/lib/prisma", () => ({ prisma: { partner: { findUnique: async () => null }, referralAgent: { findUnique: async () => null } } }));
vi.mock("@/lib/api-auth", () => ({
  getAuthUser: async () => state.user,
  requireRole: (user: { role: string } | null, roles: readonly string[]) =>
    !user ? Response.json({}, { status: 401 }) : roles.includes(user.role) ? null : Response.json({}, { status: 403 }),
}));

import { NextRequest } from "next/server";
import * as partners from "@/app/api/admin/partners/route";
import * as onePartner from "@/app/api/admin/partners/[id]/route";
import * as provision from "@/app/api/admin/partners/[id]/provision-account/route";
import * as partnerReset from "@/app/api/admin/partners/[id]/reset-password/route";
import * as apply from "@/app/api/referral-agents/register/route";
import * as verify from "@/app/api/referral-agents/verify-email/route";
import * as approve from "@/app/api/admin/referral-agents/[id]/approve/route";
import * as oneAgent from "@/app/api/admin/referral-agents/[id]/route";
// As behind the stack's edge proxy (lib/client-ip.ts).
process.env.TRUST_PROXY_HEADERS = "true";

let seq = 0;
// A fresh client address per request, so the per-address limits never trip across tests.
function request(method: string, url: string, body?: unknown, ip = `10.9.${seq}.${seq++ % 250}`) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json", "x-real-ip": ip },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const ok = (data: unknown, extra: Record<string, unknown> = {}, status = 200) => ({ ok: true, status, body: { data, ...extra } });
const refused = (status: number, code: string, message: string, details?: unknown) => ({ ok: false, status, error: { code, message, details } });
const as = (role: string) => ({ userId: `${role}1`, email: `${role}@test.invalid`, role, sid: "s", ver: 0 });

beforeEach(() => {
  callBackend.mockReset();
  state.user = null;
});

describe("partners", () => {
  beforeEach(() => {
    state.user = as("inhouse_supervisor");
  });

  it("adds through FastAPI and answers { data } with 201", async () => {
    const row = { id: "p1", name: "Agency" };
    callBackend.mockResolvedValueOnce(ok(row, {}, 201));
    const res = await partners.POST(request("POST", "/api/admin/partners", { name: "Agency" }));
    expect(callBackend).toHaveBeenCalledWith("/api/v1/partners", { method: "POST", body: { name: "Agency" } });
    expect([res.status, await res.json()]).toEqual([201, { data: row }]);
  });

  // FastAPI sends the setup emails itself since reads handover R7b
  // (vertex_be/tests/test_partner_agencies.py) and lists none of them.
  it("edits through FastAPI", async () => {
    callBackend.mockResolvedValueOnce(ok({ id: "p1" }, { notify: [] }));
    const res = await onePartner.PATCH(request("PATCH", "/api/admin/partners/p1", { contact_email: "new@test.invalid" }), ctx("p1"));
    expect(callBackend).toHaveBeenCalledWith("/api/v1/partners/p1", { method: "PATCH", body: { contact_email: "new@test.invalid" } });
    const body = await res.json();
    expect(body).toEqual({ data: { id: "p1" } });
  });

  it("refuses unreadable JSON before calling FastAPI", async () => {
    const res = await onePartner.PATCH(request("PATCH", "/api/admin/partners/p1", "{nope"), ctx("p1"));
    expect([res.status, await res.json(), callBackend.mock.calls.length]).toEqual([400, { error: { code: "invalid_json", message: "Invalid JSON" } }, 0]);
  });

  it("removes, provisions and resets", async () => {
    callBackend.mockResolvedValueOnce(ok({ id: "p1" }));
    const del = await onePartner.DELETE(request("DELETE", "/api/admin/partners/p1"), ctx("p1"));
    expect([callBackend.mock.calls[0], await del.json()]).toEqual([["/api/v1/partners/p1", { method: "DELETE" }], { data: { id: "p1" } }]);

    callBackend.mockResolvedValueOnce(ok({ id: "p2", user_id: "u2" }, { notify: [] }, 201));
    const made = await provision.POST(request("POST", "/api/admin/partners/p2/provision-account", {}), ctx("p2"));
    expect(callBackend.mock.calls[1]).toEqual(["/api/v1/partners/p2/provision-account", { method: "POST", body: {} }]);
    expect([made.status, await made.json()]).toEqual([201, { data: { id: "p2", user_id: "u2" } }]);

    callBackend.mockResolvedValueOnce(ok({ email: "c@test.invalid" }, { notify: [] }));
    const reset = await partnerReset.POST(request("POST", "/api/admin/partners/p2/reset-password"), ctx("p2"));
    expect(callBackend.mock.calls[2]).toEqual(["/api/v1/partners/p2/reset-password", { method: "POST" }]);
    expect(await reset.json()).toEqual({ data: { email: "c@test.invalid" } });
  });

  it("keeps FastAPI's errors as { error: { code, message } }", async () => {
    callBackend.mockResolvedValueOnce(refused(409, "has_activity", "This partner has 2 candidate submission(s) on file — remove or reassign them first."));
    const res = await onePartner.DELETE(request("DELETE", "/api/admin/partners/p1"), ctx("p1"));
    expect([res.status, (await res.json()).error.code]).toEqual([409, "has_activity"]);
  });

  it("refuses other roles before calling FastAPI", async () => {
    state.user = as("hr");
    expect((await partners.POST(request("POST", "/api/admin/partners", {}))).status).toBe(403);
    expect((await provision.POST(request("POST", "/api/admin/partners/p1/provision-account", {}), ctx("p1"))).status).toBe(403);
    expect(callBackend).not.toHaveBeenCalled();
  });
});

describe("referral agents", () => {
  // FastAPI sends the referral agents' emails itself since reads handover
  // R7b (vertex_be/tests/test_referral_agent_accounts.py) and lists none.
  it("passes an application on and answers as before", async () => {
    callBackend.mockResolvedValueOnce(ok({ id: "r1", referral_code: "VTX-ETH-1234" }, { notify: [] }, 201));
    const res = await apply.POST(request("POST", "/api/referral-agents/register", { full_name: "Abebe" }));
    expect(callBackend).toHaveBeenCalledWith("/api/v1/referral-agents/apply", { method: "POST", body: { full_name: "Abebe" }, asUser: false });
    const body = await res.json();
    expect([res.status, body]).toEqual([201, { data: { id: "r1", referral_code: "VTX-ETH-1234" } }]);
  });

  it("keeps the older string errors, with details for validation", async () => {
    callBackend.mockResolvedValueOnce(refused(409, "duplicate", "An application with this email already exists."));
    const dup = await apply.POST(request("POST", "/api/referral-agents/register", {}));
    expect([dup.status, await dup.json()]).toEqual([409, { error: "An application with this email already exists." }]);
    callBackend.mockResolvedValueOnce(refused(422, "validation_error", "Validation failed", { phone: ["Phone number is required"] }));
    const bad = await apply.POST(request("POST", "/api/referral-agents/register", {}));
    expect(await bad.json()).toEqual({ error: "Validation failed", details: { phone: ["Phone number is required"] } });
  });

  it("keeps the per-address limit on applications", async () => {
    callBackend.mockResolvedValue(ok({ id: "r1", referral_code: "c" }, {}, 201));
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await apply.POST(request("POST", "/api/referral-agents/register", {}, "10.5.5.5"))).status);
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
    expect(callBackend).toHaveBeenCalledTimes(5);
  });

  it("passes the verification link on and answers { message }", async () => {
    callBackend.mockResolvedValueOnce(ok({ message: "Email is already verified." }));
    const res = await verify.GET(request("GET", "/api/referral-agents/verify-email?token=t1"));
    expect(callBackend).toHaveBeenCalledWith("/api/v1/referral-agents/verify-email", { method: "POST", body: { token: "t1" }, asUser: false });
    expect(await res.json()).toEqual({ message: "Email is already verified." });
    callBackend.mockResolvedValueOnce(refused(400, "invalid_token", "Invalid or expired verification token."));
    const bad = await verify.GET(request("GET", "/api/referral-agents/verify-email?token=x"));
    expect([bad.status, await bad.json()]).toEqual([400, { error: "Invalid or expired verification token." }]);
  });

  it("approves (an empty body is no body)", async () => {
    state.user = as("director");
    callBackend.mockResolvedValueOnce(ok({ id: "r1", status: "active" }, { notify: [] }, 201));
    const res = await approve.POST(request("POST", "/api/admin/referral-agents/r1/approve"), ctx("r1"));
    expect(callBackend).toHaveBeenCalledWith("/api/v1/referral-agents/r1/approve", { method: "POST", body: {} });
    expect([res.status, await res.json()]).toEqual([201, { data: { id: "r1", status: "active" } }]);
  });

  it("rejects and suspends through FastAPI", async () => {
    state.user = as("admin");
    callBackend.mockResolvedValueOnce(ok({ id: "r1", status: "rejected" }, { notify: [] }));
    await oneAgent.PATCH(request("PATCH", "/api/admin/referral-agents/r1", { status: "rejected", reason: "No" }), ctx("r1"));
    expect(callBackend).toHaveBeenCalledWith("/api/v1/referral-agents/r1", { method: "PATCH", body: { status: "rejected", reason: "No" } });
    callBackend.mockResolvedValueOnce(ok({ id: "r2", status: "suspended" }, { notify: [] }));
    await oneAgent.PATCH(request("PATCH", "/api/admin/referral-agents/r2", { status: "suspended", reason: "Spam" }), ctx("r2"));
    expect(callBackend).toHaveBeenCalledTimes(2);
  });

  it("refuses an in-house supervisor before calling FastAPI (directors and admins only)", async () => {
    state.user = as("inhouse_supervisor");
    expect((await approve.POST(request("POST", "/api/admin/referral-agents/r1/approve", {}), ctx("r1"))).status).toBe(403);
    expect((await oneAgent.PATCH(request("PATCH", "/api/admin/referral-agents/r1", { status: "active" }), ctx("r1"))).status).toBe(403);
    expect(callBackend).not.toHaveBeenCalled();
  });
});
