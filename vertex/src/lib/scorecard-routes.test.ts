import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// /api/staff-scorecards is served by FastAPI since backend plan step 5.3:
// each handler checks the role early and passes the request on. Scoring is
// tested in vertex_be/tests/test_scorecards.py; e2e/backend.spec.ts goes
// through the real FastAPI.

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

import * as scorecards from "@/app/api/staff-scorecards/route";
import * as scorecard from "@/app/api/staff-scorecards/[id]/route";

const req = (method = "GET", body?: string, url = "http://localhost/api/staff-scorecards") =>
  new NextRequest(url, { method, body, headers: body ? { "content-type": "application/json" } : {} });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  state.role = "country_supervisor";
  callBackend.mockReset();
  callBackend.mockResolvedValue({ ok: true, status: 200, body: { data: [] } });
});

describe("passes each request on to FastAPI", () => {
  it.each([
    ["GET", () => scorecards.GET(req()), ["/api/v1/staff-scorecards", { query: {} }]],
    ["GET one staff member's", () => scorecards.GET(req("GET", undefined, "http://localhost/api/staff-scorecards?staff_id=s1")), ["/api/v1/staff-scorecards", { query: { staff_id: "s1" } }]],
    ["POST draft", () => scorecards.POST(req("POST", '{"staff_id":"s1"}')), ["/api/v1/staff-scorecards", { method: "POST", body: { staff_id: "s1" } }]],
    ["PATCH finalize", () => scorecard.PATCH(req("PATCH", "{}"), params("a/b")), ["/api/v1/staff-scorecards/a%2Fb", { method: "PATCH", body: {} }]],
  ])("%s", async (_name, call, expected) => {
    await call();
    expect(callBackend).toHaveBeenCalledWith(...expected);
  });

  it("answers with FastAPI's status and envelope", async () => {
    const error = { code: "incomplete", message: "Every area must be rated before finalizing." };
    callBackend.mockResolvedValueOnce({ ok: false, status: 422, error });
    const res = await scorecard.PATCH(req("PATCH", "{}"), params("sc1"));
    expect([res.status, await res.json()]).toEqual([422, { error }]);
  });
});

describe("refuses early, without calling FastAPI", () => {
  it("a recruiter reads their own but doesn't review", async () => {
    state.role = "regional_recruiter";
    await scorecards.GET(req());
    expect(callBackend).toHaveBeenCalledTimes(1);
    expect((await scorecards.POST(req("POST", "{}"))).status).toBe(403);
    expect((await scorecard.PATCH(req("PATCH", "{}"), params("sc1"))).status).toBe(403);
    expect(callBackend).toHaveBeenCalledTimes(1);
  });

  it.each([["marketing"], ["hr"], ["candidate"]])("%s can't read", async (role) => {
    state.role = role;
    expect((await scorecards.GET(req())).status).toBe(403);
    expect(callBackend).not.toHaveBeenCalled();
  });

  it("a body that isn't JSON", async () => {
    expect((await scorecard.PATCH(req("PATCH", "{nope"), params("sc1"))).status).toBe(400);
    expect(callBackend).not.toHaveBeenCalled();
  });
});
