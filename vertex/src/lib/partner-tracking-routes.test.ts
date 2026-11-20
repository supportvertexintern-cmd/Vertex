import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Partner tracking (Phase 6) is FastAPI's (vertex_be/app/api/v1/partner_tracking.py):
// each handler checks the role early and passes the request on; FastAPI keeps
// a virtual assistant to its own partners. e2e/va-portal.spec.ts goes through
// the real FastAPI.

const state = vi.hoisted(() => ({ role: "virtual_assistant" as string | null }));

vi.mock("@/lib/api-auth", () => {
  const deny = (status: number) => Response.json({ error: "denied" }, { status });
  return {
    getAuthUser: async () => (state.role ? { userId: "u1", email: "u@test.invalid", role: state.role, sid: "s", ver: 0 } : null),
    requireRole: (user: { role: string } | null, roles: string[]) => (!user ? deny(401) : roles.includes(user.role) ? null : deny(403)),
  };
});

const callBackend = vi.fn();
vi.mock("@/lib/backend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/backend")>()),
  callBackend: (...args: unknown[]) => callBackend(...args),
}));

import * as tracking from "@/app/api/management/partners/[id]/tracking/route";
import * as reports from "@/app/api/partner-reports/route";
import * as report from "@/app/api/partner-reports/[id]/route";
import * as followUps from "@/app/api/partner-follow-ups/route";
import * as followUp from "@/app/api/partner-follow-ups/[id]/route";
import * as vaUsers from "@/app/api/admin/va-users/route";

const req = (method = "GET", body?: string) =>
  new NextRequest("http://localhost/api/x", { method, body, headers: body ? { "content-type": "application/json" } : {} });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  state.role = "virtual_assistant";
  callBackend.mockReset();
  callBackend.mockResolvedValue({ ok: true, status: 200, body: { data: {} } });
});

describe("passes each request on to FastAPI", () => {
  it.each([
    ["the panel", () => tracking.GET(req(), params("p/1")), ["/api/v1/partners/p%2F1/tracking"]],
    ["a report", () => reports.POST(req("POST", '{"partner_id":"p1","content":"Notes"}')), ["/api/v1/partner-reports", { method: "POST", body: { partner_id: "p1", content: "Notes" } }]],
    ["a report's status", () => report.PATCH(req("PATCH", '{"status":"closed"}'), params("r1")), ["/api/v1/partner-reports/r1", { method: "PATCH", body: { status: "closed" } }]],
    ["a follow-up", () => followUps.POST(req("POST", '{"partner_id":"p1","action":"Call"}')), ["/api/v1/partner-follow-ups", { method: "POST", body: { partner_id: "p1", action: "Call" } }]],
    ["a follow-up done", () => followUp.PATCH(req("PATCH", '{"status":"done"}'), params("f1")), ["/api/v1/partner-follow-ups/f1", { method: "PATCH", body: { status: "done" } }]],
  ])("%s", async (_name, call, expected) => {
    await call();
    expect(callBackend).toHaveBeenCalledWith(...expected);
  });

  it("the VA team, for a manager", async () => {
    state.role = "director";
    await vaUsers.GET(req());
    expect(callBackend).toHaveBeenCalledWith("/api/v1/va-users");
  });

  it("answers with FastAPI's refusal of another VA's partner", async () => {
    const error = { code: "forbidden", message: "This partner is not assigned to you." };
    callBackend.mockResolvedValueOnce({ ok: false, status: 403, error });
    const res = await tracking.GET(req(), params("p2"));
    expect([res.status, await res.json()]).toEqual([403, { error }]);
  });
});

describe("refuses early, without calling FastAPI", () => {
  it("anyone outside partner tracking", async () => {
    state.role = "hr";
    expect((await tracking.GET(req(), params("p1"))).status).toBe(403);
    expect((await reports.POST(req("POST", "{}"))).status).toBe(403);
    state.role = null;
    expect((await followUps.POST(req("POST", "{}"))).status).toBe(401);
    expect(callBackend).not.toHaveBeenCalled();
  });

  it("a VA from the team list, which is the managers'", async () => {
    expect((await vaUsers.GET(req())).status).toBe(403);
    expect(callBackend).not.toHaveBeenCalled();
  });

  it("a body that isn't JSON", async () => {
    expect((await reports.POST(new NextRequest("http://localhost/api/x", { method: "POST", body: "not json", headers: { "content-type": "application/json" } }))).status).toBe(400);
    expect(callBackend).not.toHaveBeenCalled();
  });
});
