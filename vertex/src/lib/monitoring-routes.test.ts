// Admin → Monitoring, phase 1 (2026-11-07): the User Accounts routes pass
// requests on to FastAPI, which decides every rule
// (vertex_be/tests/test_account_monitoring.py). Here: admins only, and each
// request reaches the right path with its query, body and the browser's address.
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ user: null as null | { userId: string; email: string; role: string; sid: string; ver: number } }));

const callBackend = vi.fn();
const passFile = vi.fn();
vi.mock("@/lib/backend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/backend")>()),
  callBackend: (...args: unknown[]) => callBackend(...args),
  passFile: (...args: unknown[]) => passFile(...args),
}));
vi.mock("@/lib/api-auth", () => ({
  getAuthUser: async () => state.user,
  requireAdmin: (user: { role: string } | null) => (!user ? Response.json({}, { status: 401 }) : user.role === "admin" ? null : Response.json({}, { status: 403 })),
}));

import { NextRequest } from "next/server";
import { GET as listAccounts } from "@/app/api/admin/monitoring/accounts/route";
import { GET as getAccount } from "@/app/api/admin/monitoring/accounts/[id]/route";
import { POST as deactivate } from "@/app/api/admin/users/[id]/deactivate/route";
import { POST as reactivate } from "@/app/api/admin/users/[id]/reactivate/route";
import { POST as setupEmail } from "@/app/api/admin/users/[id]/setup-email/route";
import { DELETE as endSession } from "@/app/api/admin/users/[id]/sessions/[sessionId]/route";
import { GET as listAlerts } from "@/app/api/admin/monitoring/alerts/route";
import { GET as alertSummary } from "@/app/api/admin/monitoring/alerts/summary/route";
import { GET as alertRules } from "@/app/api/admin/monitoring/alerts/rules/route";
import { PATCH as reviewAlert } from "@/app/api/admin/monitoring/alerts/[id]/route";
import { GET as listPartners } from "@/app/api/admin/monitoring/partners/route";
import { GET as partnerOptions } from "@/app/api/admin/monitoring/partners/options/route";
import { GET as exportPartners } from "@/app/api/admin/monitoring/partners/export/route";
import { GET as overview } from "@/app/api/admin/monitoring/overview/route";
import { POST as runChecks } from "@/app/api/admin/monitoring/checks/run/route";
import { GET as auditTrail } from "@/app/api/admin/monitoring/audit/route";

process.env.TRUST_PROXY_HEADERS = "true";

const admin = { userId: "a1", email: "admin@test.invalid", role: "admin", sid: "f1", ver: 0 };
const ok = (data: unknown) => ({ ok: true, status: 200, body: { data } });
const id = { params: Promise.resolve({ id: "u2" }) };

function post(body: unknown) {
  return new NextRequest("http://localhost/x", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": "203.0.113.9" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  callBackend.mockReset();
  passFile.mockReset();
  state.user = null;
});

describe("User Accounts routes", () => {
  it("are for admins only", async () => {
    const calls = [
      () => listAccounts(new NextRequest("http://localhost/api/admin/monitoring/accounts")),
      () => getAccount(new NextRequest("http://localhost/x"), id),
      () => deactivate(post({ reason: "Left" }), id),
      () => reactivate(post({ reason: "Back" }), id),
      () => setupEmail(post({}), id),
      () => endSession(new NextRequest("http://localhost/x", { method: "DELETE" }), { params: Promise.resolve({ id: "u2", sessionId: "s1" }) }),
    ];
    for (const call of calls) expect((await call()).status).toBe(401);
    state.user = { ...admin, role: "director" };
    for (const call of calls) expect((await call()).status).toBe(403);
    expect(callBackend).not.toHaveBeenCalled();
  });

  it("pass the list's filters on, leaving out empty ones", async () => {
    state.user = admin;
    callBackend.mockResolvedValueOnce({ ok: true, status: 200, body: { data: [], total: 0, page: 2, pageSize: 25 } });
    const res = await listAccounts(new NextRequest("http://localhost/api/admin/monitoring/accounts?q=ab&role=partner&status=&inactive_days=30&page=2&pageSize=25&evil=1"));
    expect(await res.json()).toEqual({ data: [], total: 0, page: 2, pageSize: 25 });
    const [path, options] = callBackend.mock.calls[0];
    expect(path).toBe("/api/v1/monitoring/accounts");
    expect(Object.fromEntries(Object.entries(options.query).filter(([, v]) => v !== undefined))).toEqual({
      q: "ab", role: "partner", inactive_days: "30", page: "2", pageSize: "25",
    });
  });

  it("deactivate and reactivate send the reason and the browser's address", async () => {
    state.user = admin;
    callBackend.mockResolvedValue(ok({ id: "u2", ended: 1 }));
    await deactivate(post({ reason: "Left the company" }), id);
    await reactivate(post({ reason: "Rehired" }), id);
    const [[offPath, off], [onPath, on]] = callBackend.mock.calls;
    expect([offPath, off.method, off.body]).toEqual(["/api/v1/users/u2/deactivate", "POST", { reason: "Left the company" }]);
    expect([onPath, on.method, on.body]).toEqual(["/api/v1/users/u2/reactivate", "POST", { reason: "Rehired" }]);
    expect(off.forward).toBeTruthy();
  });

  it("an unreadable body is a 400, not a call", async () => {
    state.user = admin;
    expect((await deactivate(post("{not json"), id)).status).toBe(400);
    expect(callBackend).not.toHaveBeenCalled();
  });

  it("FastAPI's refusal comes back as it is", async () => {
    state.user = admin;
    callBackend.mockResolvedValueOnce({ ok: false, status: 409, error: { code: "last_admin", message: "There must always be at least one admin." } });
    const res = await deactivate(post({ reason: "Testing" }), id);
    expect([res.status, await res.json()]).toEqual([409, { error: { code: "last_admin", message: "There must always be at least one admin." } }]);
  });

  it("the detail, the setup email and one session reach their paths", async () => {
    state.user = admin;
    callBackend.mockResolvedValue(ok({}));
    await getAccount(new NextRequest("http://localhost/x"), id);
    await setupEmail(post({}), id);
    await endSession(new NextRequest("http://localhost/x", { method: "DELETE" }), { params: Promise.resolve({ id: "u2", sessionId: "s/1" }) });
    expect(callBackend.mock.calls.map(([path, options]) => [path, options?.method ?? "GET"])).toEqual([
      ["/api/v1/monitoring/accounts/u2", "GET"],
      ["/api/v1/users/u2/setup-email", "POST"],
      ["/api/v1/users/u2/sessions/s%2F1", "DELETE"],
    ]);
  });
});

describe("Suspicious Activity routes (phase 2)", () => {
  const alertId = { params: Promise.resolve({ id: "al1" }) };
  const patch = (body: unknown) =>
    new NextRequest("http://localhost/x", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("are for admins only", async () => {
    state.user = { ...admin, role: "hr" };
    expect((await listAlerts(new NextRequest("http://localhost/api/admin/monitoring/alerts"))).status).toBe(403);
    expect((await alertSummary(new NextRequest("http://localhost/x"))).status).toBe(403);
    expect((await alertRules(new NextRequest("http://localhost/x"))).status).toBe(403);
    expect((await reviewAlert(patch({ status: "reviewing" }), alertId)).status).toBe(403);
    expect(callBackend).not.toHaveBeenCalled();
  });

  it("keep a repeated status, drop unknown and empty keys", async () => {
    state.user = admin;
    callBackend.mockResolvedValueOnce({ ok: true, status: 200, body: { data: [], total: 0, page: 1, pageSize: 25 } });
    await listAlerts(new NextRequest("http://localhost/api/admin/monitoring/alerts?status=open&status=reviewing&severity=&rule=brute_force_ip&evil=1&page=1"));
    expect(callBackend.mock.calls[0][0]).toBe("/api/v1/monitoring/alerts?status=open&status=reviewing&rule=brute_force_ip&page=1");
  });

  it("the summary, the rules and a review reach their paths", async () => {
    state.user = admin;
    callBackend.mockResolvedValue(ok({}));
    await alertSummary(new NextRequest("http://localhost/x"));
    await alertRules(new NextRequest("http://localhost/x"));
    await reviewAlert(patch({ status: "resolved", note: "It was them." }), alertId);
    expect(callBackend.mock.calls.map(([path, options]) => [path, options?.method ?? "GET", options?.body])).toEqual([
      ["/api/v1/monitoring/alerts/summary", "GET", undefined],
      ["/api/v1/monitoring/alerts/rules", "GET", undefined],
      ["/api/v1/monitoring/alerts/al1", "PATCH", { status: "resolved", note: "It was them." }],
    ]);
  });
});

describe("Partners & Logins routes (phase 3)", () => {
  it("are for admins only", async () => {
    state.user = { ...admin, role: "director" };
    expect((await listPartners(new NextRequest("http://localhost/x"))).status).toBe(403);
    expect((await partnerOptions(new NextRequest("http://localhost/x"))).status).toBe(403);
    expect((await exportPartners(new NextRequest("http://localhost/x"))).status).toBe(403);
    expect(callBackend).not.toHaveBeenCalled();
    expect(passFile).not.toHaveBeenCalled();
  });

  it("the list and the CSV pass on the same filters; the CSV has no paging", async () => {
    state.user = admin;
    callBackend.mockResolvedValueOnce({ ok: true, status: 200, body: { data: [], total: 0, page: 1, pageSize: 25 } });
    const { NextResponse } = await import("next/server");
    passFile.mockResolvedValueOnce(new NextResponse("Agency,Type", { headers: { "Content-Type": "text/csv" } }));
    const qs = "q=abc&country=Kenya&status=active&login_status=deactivated&created_by=u9&page=2&pageSize=25&evil=1";
    await listPartners(new NextRequest(`http://localhost/x?${qs}`));
    const csv = await exportPartners(new NextRequest(`http://localhost/x?${qs}`));
    const defined = (q: Record<string, unknown>) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined));
    expect(callBackend.mock.calls[0][0]).toBe("/api/v1/monitoring/partners");
    expect(defined(callBackend.mock.calls[0][1].query)).toEqual({ q: "abc", country: "Kenya", status: "active", login_status: "deactivated", created_by: "u9", page: "2", pageSize: "25" });
    expect(passFile.mock.calls[0][0]).toBe("/api/v1/monitoring/partners.csv");
    expect(defined(passFile.mock.calls[0][1].query)).toEqual({ q: "abc", country: "Kenya", status: "active", login_status: "deactivated", created_by: "u9" });
    expect(await csv.text()).toBe("Agency,Type");
  });

  it("a refused export comes back as an error, not a file", async () => {
    state.user = admin;
    passFile.mockResolvedValueOnce({ ok: false, status: 503, error: { code: "audit_unavailable", message: "The export couldn't be recorded, so it wasn't made." } });
    const res = await exportPartners(new NextRequest("http://localhost/x"));
    expect(res.status).toBe(503);
  });
});

describe("Audit Trail and Security Overview routes (phases 4 and 5)", () => {
  it("are for admins only", async () => {
    state.user = { ...admin, role: "partner" };
    expect((await overview(new NextRequest("http://localhost/x"))).status).toBe(403);
    expect((await runChecks(new NextRequest("http://localhost/x", { method: "POST" }))).status).toBe(403);
    expect((await auditTrail(new NextRequest("http://localhost/x"))).status).toBe(403);
    expect(callBackend).not.toHaveBeenCalled();
  });

  it("the trail passes on its filters and the browser's address; the others their paths", async () => {
    state.user = admin;
    callBackend.mockResolvedValue({ ok: true, status: 200, body: { data: [], total: 0, page: 1, pageSize: 50 } });
    await auditTrail(new NextRequest("http://localhost/x?entity_type=Partner&entity_id=p1&action=update&evil=1", { headers: { "x-real-ip": "203.0.113.9" } }));
    await overview(new NextRequest("http://localhost/x"));
    await runChecks(new NextRequest("http://localhost/x", { method: "POST" }));
    const [[trailPath, trail], [overviewPath], [checksPath, checks]] = callBackend.mock.calls;
    expect(trailPath).toBe("/api/v1/monitoring/audit");
    expect(Object.fromEntries(Object.entries(trail.query).filter(([, v]) => v !== undefined))).toEqual({ entity_type: "Partner", entity_id: "p1", action: "update" });
    expect(trail.forward).toBeTruthy();
    expect([overviewPath, checksPath, checks.method]).toEqual(["/api/v1/monitoring/overview", "/api/v1/monitoring/checks/run", "POST"]);
  });
});
