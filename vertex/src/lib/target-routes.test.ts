import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Recruiter targets, staff KPI target writes and recruiter notes are served
// by FastAPI since backend plan step 5.2: each handler checks the role early
// and passes the request on. callBackend() itself is tested in
// lib/backend.test.ts; e2e/backend.spec.ts goes through the real FastAPI.

const state = vi.hoisted(() => ({ role: "country_supervisor" as string | null }));

vi.mock("@/lib/api-auth", () => {
  const deny = (status: number) => Response.json({ error: "denied" }, { status });
  return {
    getAuthUser: async () => (state.role ? { userId: "u1", email: "u@test.invalid", role: state.role, sid: "s", ver: 0 } : null),
    requireRole: (user: { role: string } | null, roles: readonly string[]) => (!user ? deny(401) : roles.includes(user.role) ? null : deny(403)),
    forbidden: (body: unknown) => Response.json(body, { status: 403 }),
  };
});

const callBackend = vi.fn();
vi.mock("@/lib/backend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/backend")>()),
  callBackend: (...args: unknown[]) => callBackend(...args),
}));

import * as recruiterTargets from "@/app/api/recruiter-targets/route";
import * as kpiTargets from "@/app/api/staff-kpi-targets/route";
import * as notes from "@/app/api/recruiter-notes/route";

const req = (method = "GET", body?: string, url = "http://localhost/api/x") =>
  new NextRequest(url, { method, body, headers: body ? { "content-type": "application/json" } : {} });

beforeEach(() => {
  state.role = "country_supervisor";
  callBackend.mockReset();
  callBackend.mockResolvedValue({ ok: true, status: 200, body: { data: [] } });
});

describe("passes each request on to FastAPI", () => {
  it.each([
    ["GET recruiter targets", () => recruiterTargets.GET(req()), ["/api/v1/recruiter-targets", { query: {} }]],
    [
      "GET recruiter targets for one campaign target",
      () => recruiterTargets.GET(req("GET", undefined, "http://localhost/api/recruiter-targets?campaign_target_id=t1")),
      ["/api/v1/recruiter-targets", { query: { campaign_target_id: "t1" } }],
    ],
    ["POST recruiter target", () => recruiterTargets.POST(req("POST", '{"target_value":5}')), ["/api/v1/recruiter-targets", { method: "POST", body: { target_value: 5 } }]],
    ["POST KPI target", () => kpiTargets.POST(req("POST", '{"cycle":"weekly"}')), ["/api/v1/staff-kpi-targets", { method: "POST", body: { cycle: "weekly" } }]],
    [
      "GET notes",
      () => notes.GET(req("GET", undefined, "http://localhost/api/recruiter-notes?recruiter_id=r1")),
      ["/api/v1/recruiter-notes", { query: { recruiter_id: "r1" } }],
    ],
    ["POST note", () => notes.POST(req("POST", '{"message":"Hi"}')), ["/api/v1/recruiter-notes", { method: "POST", body: { message: "Hi" } }]],
  ])("%s", async (_name, call, expected) => {
    await call();
    expect(callBackend).toHaveBeenCalledWith(...expected);
  });

  it("answers with FastAPI's status and envelope", async () => {
    const error = { code: "forbidden", message: "You can only set targets for your own direct reports." };
    callBackend.mockResolvedValueOnce({ ok: false, status: 403, error });
    const res = await kpiTargets.POST(req("POST", "{}"));
    expect([res.status, await res.json()]).toEqual([403, { error }]);
  });
});

describe("refuses early, without calling FastAPI", () => {
  it("a recruiter reads but doesn't set targets or write notes", async () => {
    state.role = "regional_recruiter";
    await recruiterTargets.GET(req());
    await notes.GET(req());
    expect(callBackend).toHaveBeenCalledTimes(2);
    expect((await recruiterTargets.POST(req("POST", "{}"))).status).toBe(403);
    expect((await notes.POST(req("POST", "{}"))).status).toBe(403);
    expect(callBackend).toHaveBeenCalledTimes(2);
  });

  it.each([["marketing"], ["hr"], ["candidate"]])("%s reads none of it", async (role) => {
    state.role = role;
    expect((await recruiterTargets.GET(req())).status).toBe(403);
    expect((await notes.GET(req())).status).toBe(403);
    expect((await kpiTargets.POST(req("POST", "{}"))).status).toBe(403);
    expect(callBackend).not.toHaveBeenCalled();
  });

  it("a body that isn't JSON", async () => {
    expect((await kpiTargets.POST(req("POST", "{nope"))).status).toBe(400);
    expect(callBackend).not.toHaveBeenCalled();
  });
});
