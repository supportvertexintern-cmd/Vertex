import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// /api/campaigns and its targets are served by FastAPI since backend plan
// step 5.1: each handler checks the role early and passes the request on.
// callBackend() itself is tested in lib/backend.test.ts; e2e/backend.spec.ts
// goes through the real FastAPI.

const state = vi.hoisted(() => ({ role: "inhouse_supervisor" as string | null }));

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

import * as campaigns from "@/app/api/campaigns/route";
import * as campaign from "@/app/api/campaigns/[id]/route";
import * as targets from "@/app/api/campaigns/[id]/targets/route";
import * as target from "@/app/api/campaigns/[id]/targets/[targetId]/route";

const req = (method = "GET", body?: string, url = "http://localhost/api/campaigns") =>
  new NextRequest(url, { method, body, headers: body ? { "content-type": "application/json" } : {} });
const params = (id: string, targetId = "") => ({ params: Promise.resolve({ id, targetId }) });

beforeEach(() => {
  state.role = "inhouse_supervisor";
  callBackend.mockReset();
  callBackend.mockResolvedValue({ ok: true, status: 200, body: { data: [] } });
});

describe("passes each request on to FastAPI", () => {
  it.each([
    ["GET list", () => campaigns.GET(req()), ["/api/v1/campaigns", { query: {} }]],
    ["GET list, scoped", () => campaigns.GET(req("GET", undefined, "http://localhost/api/campaigns?scope=mine&status=active&x=1")), ["/api/v1/campaigns", { query: { status: "active", scope: "mine" } }]],
    ["POST", () => campaigns.POST(req("POST", '{"name":"Spring"}')), ["/api/v1/campaigns", { method: "POST", body: { name: "Spring" } }]],
    ["GET one", () => campaign.GET(req(), params("a/b")), ["/api/v1/campaigns/a%2Fb"]],
    ["PATCH", () => campaign.PATCH(req("PATCH", '{"status":"active"}'), params("c1")), ["/api/v1/campaigns/c1", { method: "PATCH", body: { status: "active" } }]],
    ["DELETE", () => campaign.DELETE(req("DELETE"), params("c1")), ["/api/v1/campaigns/c1", { method: "DELETE" }]],
    ["POST target", () => targets.POST(req("POST", '{"metric":"verified_candidates"}'), params("c1")), ["/api/v1/campaigns/c1/targets", { method: "POST", body: { metric: "verified_candidates" } }]],
    ["DELETE target", () => target.DELETE(req("DELETE"), params("c1", "t1")), ["/api/v1/campaigns/c1/targets/t1", { method: "DELETE" }]],
  ])("%s", async (_name, call, expected) => {
    await call();
    expect(callBackend).toHaveBeenCalledWith(...expected);
  });

  it("answers with FastAPI's status and envelope", async () => {
    const error = { code: "forbidden", message: "You can only edit campaigns you created." };
    callBackend.mockResolvedValueOnce({ ok: false, status: 403, error });
    const res = await campaign.PATCH(req("PATCH", "{}"), params("c1"));
    expect([res.status, await res.json()]).toEqual([403, { error }]);
  });
});

describe("refuses early, without calling FastAPI", () => {
  it("a recruiter reads but doesn't manage", async () => {
    state.role = "regional_recruiter";
    await campaigns.GET(req());
    expect(callBackend).toHaveBeenCalledTimes(1);
    const writes = [campaigns.POST(req("POST", "{}")), campaign.DELETE(req("DELETE"), params("c1")), targets.POST(req("POST", "{}"), params("c1"))];
    for (const res of await Promise.all(writes)) expect(res.status).toBe(403);
    expect(callBackend).toHaveBeenCalledTimes(1);
  });

  it.each([["marketing"], ["hr"], ["candidate"]])("%s can't read", async (role) => {
    state.role = role;
    expect((await campaigns.GET(req())).status).toBe(403);
    expect(callBackend).not.toHaveBeenCalled();
  });

  it("a body that isn't JSON", async () => {
    expect((await campaigns.POST(req("POST", "{nope"))).status).toBe(400);
    expect(callBackend).not.toHaveBeenCalled();
  });
});
