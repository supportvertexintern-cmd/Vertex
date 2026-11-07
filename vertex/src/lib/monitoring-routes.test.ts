// Admin → Monitoring, phase 1 (2026-11-07): the User Accounts routes pass
// requests on to FastAPI, which decides every rule
// (vertex_be/tests/test_account_monitoring.py). Here: admins only, and each
// request reaches the right path with its query, body and the browser's address.
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ user: null as null | { userId: string; email: string; role: string; sid: string; ver: number } }));

const callBackend = vi.fn();
vi.mock("@/lib/backend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/backend")>()),
  callBackend: (...args: unknown[]) => callBackend(...args),
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
