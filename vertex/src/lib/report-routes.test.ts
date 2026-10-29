import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Report writes are served by FastAPI since backend plan step 5.4: each
// handler checks the role early and passes the request on. The reporting
// line is tested in vertex_be/tests/test_reports.py; e2e/backend.spec.ts
// goes through the real FastAPI.

const state = vi.hoisted(() => ({ role: "country_supervisor" as string | null }));

vi.mock("@/lib/api-auth", () => {
  const deny = (status: number) => Response.json({ error: "denied" }, { status });
  return {
    getAuthUser: async () => (state.role ? { userId: "u1", email: "u@test.invalid", role: state.role, sid: "s", ver: 0 } : null),
    requireRole: (user: { role: string } | null, roles: readonly string[]) => (!user ? deny(401) : roles.includes(user.role) ? null : deny(403)),
  };
});

const callBackend = vi.fn();
vi.mock("@/lib/backend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/backend")>()),
  callBackend: (...args: unknown[]) => callBackend(...args),
}));

import * as reports from "@/app/api/reports/route";
import * as verify from "@/app/api/reports/[id]/verify/route";
import * as ret from "@/app/api/reports/[id]/return/route";
import * as resubmit from "@/app/api/reports/[id]/resubmit/route";

const req = (method = "GET", body?: string) =>
  new NextRequest("http://localhost/api/reports", { method, body, headers: body ? { "content-type": "application/json" } : {} });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  state.role = "country_supervisor";
  callBackend.mockReset();
  callBackend.mockResolvedValue({ ok: true, status: 200, body: { data: { id: "r1", status: "submitted" } } });
});

describe("passes each write on to FastAPI", () => {
  it.each([
    ["POST", () => reports.POST(req("POST", '{"type":"weekly"}')), ["/api/v1/reports", { method: "POST", body: { type: "weekly" } }]],
    ["verify", () => verify.PATCH(req("PATCH"), params("a/b")), ["/api/v1/reports/a%2Fb/verify", { method: "PATCH" }]],
    ["return", () => ret.PATCH(req("PATCH", '{"return_reason":"Fix it."}'), params("r1")), ["/api/v1/reports/r1/return", { method: "PATCH", body: { return_reason: "Fix it." } }]],
    ["resubmit", () => resubmit.PATCH(req("PATCH", '{"content":{}}'), params("r1")), ["/api/v1/reports/r1/resubmit", { method: "PATCH", body: { content: {} } }]],
  ])("%s", async (_name, call, expected) => {
    await call();
    expect(callBackend).toHaveBeenCalledWith(...expected);
  });

  it("answers with FastAPI's status and envelope", async () => {
    const error = { code: "invalid_children", message: "Every consolidated report must be a verified report from your own country." };
    callBackend.mockResolvedValueOnce({ ok: false, status: 422, error });
    const res = await reports.POST(req("POST", "{}"));
    expect([res.status, await res.json()]).toEqual([422, { error }]);
  });
});

describe("refuses early, without calling FastAPI", () => {
  it("a director reviews but doesn't submit", async () => {
    state.role = "director";
    expect((await reports.POST(req("POST", "{}"))).status).toBe(403);
    expect((await resubmit.PATCH(req("PATCH", "{}"), params("r1"))).status).toBe(403);
    await verify.PATCH(req("PATCH"), params("r1"));
    expect(callBackend).toHaveBeenCalledTimes(1);
  });

  it("a recruiter submits and resubmits but doesn't review", async () => {
    state.role = "regional_recruiter";
    expect((await verify.PATCH(req("PATCH"), params("r1"))).status).toBe(403);
    expect((await ret.PATCH(req("PATCH", "{}"), params("r1"))).status).toBe(403);
    expect(callBackend).not.toHaveBeenCalled();
  });

  it("a body that isn't JSON", async () => {
    expect((await ret.PATCH(req("PATCH", "{nope"), params("r1"))).status).toBe(400);
    expect(callBackend).not.toHaveBeenCalled();
  });
});
