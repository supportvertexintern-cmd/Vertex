import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// /api/admin/employer-clients is served by FastAPI since backend plan step
// 4.1: each handler checks the role early and passes the request on.
// callBackend() itself is tested in lib/backend.test.ts; e2e/backend.spec.ts
// goes through the real FastAPI.

const state = vi.hoisted(() => ({ role: "director" as string | null }));

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

import * as clients from "@/app/api/admin/employer-clients/route";
import * as client from "@/app/api/admin/employer-clients/[id]/route";

const req = (method = "GET", body?: string) =>
  new NextRequest("http://localhost/api/admin/employer-clients", { method, body, headers: body ? { "content-type": "application/json" } : {} });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  state.role = "director";
  callBackend.mockReset();
  callBackend.mockResolvedValue({ ok: true, status: 200, body: { data: [] } });
});

describe("passes each request on to FastAPI", () => {
  it.each([
    ["GET list", () => clients.GET(req()), ["/api/v1/employer-clients"]],
    ["POST", () => clients.POST(req("POST", '{"name":"Agro"}')), ["/api/v1/employer-clients", { method: "POST", body: { name: "Agro" } }]],
    ["GET one", () => client.GET(req(), params("a/b")), ["/api/v1/employer-clients/a%2Fb"]],
    ["PATCH", () => client.PATCH(req("PATCH", '{"status":"inactive"}'), params("c1")), ["/api/v1/employer-clients/c1", { method: "PATCH", body: { status: "inactive" } }]],
  ])("%s", async (_name, call, expected) => {
    await call();
    expect(callBackend).toHaveBeenCalledWith(...expected);
  });

  it("answers with FastAPI's status and envelope", async () => {
    const error = { code: "not_found", message: "Employer/client not found." };
    callBackend.mockResolvedValueOnce({ ok: false, status: 404, error });
    const res = await client.GET(req(), params("c9"));
    expect([res.status, await res.json()]).toEqual([404, { error }]);
  });
});

describe("refuses early, without calling FastAPI", () => {
  it("marketing reads but doesn't write", async () => {
    state.role = "marketing";
    await clients.GET(req());
    expect(callBackend).toHaveBeenCalledTimes(1);
    expect((await clients.POST(req("POST", "{}"))).status).toBe(403);
    expect((await client.PATCH(req("PATCH", "{}"), params("c1"))).status).toBe(403);
    expect(callBackend).toHaveBeenCalledTimes(1);
  });

  it.each([["inhouse_supervisor"], ["hr"], ["partner"]])("%s does neither", async (role) => {
    state.role = role;
    expect((await clients.GET(req())).status).toBe(403);
    expect((await client.GET(req(), params("c1"))).status).toBe(403);
    expect(callBackend).not.toHaveBeenCalled();
  });

  it("a body that isn't JSON", async () => {
    expect((await clients.POST(req("POST", "{nope"))).status).toBe(400);
    expect(callBackend).not.toHaveBeenCalled();
  });
});
