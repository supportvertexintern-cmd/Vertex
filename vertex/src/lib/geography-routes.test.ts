import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// /api/admin/regions and /api/admin/countries are served by FastAPI since
// backend plan step 2.1: each handler checks the role early and passes the
// request on. callBackend() itself is tested in lib/backend.test.ts; the
// end-to-end journeys (e2e/backend.spec.ts) go through the real FastAPI.

const state = vi.hoisted(() => ({ role: "admin" as string | null }));

vi.mock("@/lib/api-auth", () => {
  const deny = (status: number) => Response.json({ error: "denied" }, { status });
  const requireRole = (user: { role: string } | null, roles: string[]) =>
    !user ? deny(401) : roles.includes(user.role) ? null : deny(403);
  return {
    getAuthUser: async () => (state.role ? { userId: "u1", email: "u@test.invalid", role: state.role, sid: "s", ver: 0 } : null),
    requireRole,
    requireAdmin: (user: { role: string } | null) => requireRole(user, ["admin"]),
  };
});

const callBackend = vi.fn();
vi.mock("@/lib/backend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/backend")>()),
  callBackend: (...args: unknown[]) => callBackend(...args),
}));

import * as regions from "@/app/api/admin/regions/route";
import * as region from "@/app/api/admin/regions/[id]/route";
import * as countries from "@/app/api/admin/countries/route";
import * as country from "@/app/api/admin/countries/[id]/route";

const req = (method = "GET", body?: string) =>
  new NextRequest("http://localhost/api/admin/x", { method, body, headers: body ? { "content-type": "application/json" } : {} });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  state.role = "admin";
  callBackend.mockReset();
  callBackend.mockResolvedValue({ ok: true, status: 200, body: { data: [] } });
});

describe("passes each request on to FastAPI", () => {
  it.each([
    ["GET regions", () => regions.GET(req()), ["/api/v1/regions"]],
    ["POST regions", () => regions.POST(req("POST", '{"name":"Europe"}')), ["/api/v1/regions", { method: "POST", body: { name: "Europe" } }]],
    ["PATCH region", () => region.PATCH(req("PATCH", '{"name":"EU"}'), params("r1")), ["/api/v1/regions/r1", { method: "PATCH", body: { name: "EU" } }]],
    ["GET countries", () => countries.GET(req()), ["/api/v1/countries"]],
    ["POST countries", () => countries.POST(req("POST", '{"name":"Kenya","region_id":"r1"}')), ["/api/v1/countries", { method: "POST", body: { name: "Kenya", region_id: "r1" } }]],
    ["PATCH country", () => country.PATCH(req("PATCH", '{"name":"Kenya"}'), params("c1")), ["/api/v1/countries/c1", { method: "PATCH", body: { name: "Kenya" } }]],
    ["DELETE country", () => country.DELETE(req("DELETE"), params("c1")), ["/api/v1/countries/c1", { method: "DELETE" }]],
  ])("%s", async (_name, call, expected) => {
    await call();
    expect(callBackend).toHaveBeenCalledWith(...expected);
  });

  it("answers with FastAPI's status and body (201 on create, errors as they are)", async () => {
    callBackend.mockResolvedValueOnce({ ok: true, status: 201, body: { data: { id: "r9", name: "Europe" } } });
    const created = await regions.POST(req("POST", '{"name":"Europe"}'));
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ data: { id: "r9", name: "Europe" } });

    const error = { code: "duplicate", message: "A country with this name already exists." };
    callBackend.mockResolvedValueOnce({ ok: false, status: 409, error });
    const dup = await countries.POST(req("POST", '{"name":"Kenya","region_id":"r1"}'));
    expect(dup.status).toBe(409);
    expect(await dup.json()).toEqual({ error });
  });

  it("keeps an id with odd characters inside its path segment", async () => {
    await country.DELETE(req("DELETE"), params("../users"));
    expect(callBackend).toHaveBeenCalledWith("/api/v1/countries/..%2Fusers", { method: "DELETE" });
  });
});

describe("refuses early, without calling FastAPI", () => {
  it.each([["candidate"], ["marketing"], ["partner"]])("lists for %s", async (role) => {
    state.role = role;
    expect((await regions.GET(req())).status).toBe(403);
    expect((await countries.GET(req())).status).toBe(403);
    expect(callBackend).not.toHaveBeenCalled();
  });

  it("hr reads countries but not regions", async () => {
    state.role = "hr";
    expect((await regions.GET(req())).status).toBe(403);
    await countries.GET(req());
    expect(callBackend).toHaveBeenCalledTimes(1);
  });

  it("writes for anyone but admin", async () => {
    state.role = "director";
    const writes = [
      regions.POST(req("POST", "{}")),
      region.PATCH(req("PATCH", "{}"), params("r1")),
      countries.POST(req("POST", "{}")),
      country.PATCH(req("PATCH", "{}"), params("c1")),
      country.DELETE(req("DELETE"), params("c1")),
    ];
    for (const res of await Promise.all(writes)) expect(res.status).toBe(403);
    expect(callBackend).not.toHaveBeenCalled();
  });

  it("no session", async () => {
    state.role = null;
    expect((await countries.GET(req())).status).toBe(401);
    expect(callBackend).not.toHaveBeenCalled();
  });

  it("a body that isn't JSON", async () => {
    const res = await regions.POST(req("POST", "{nope"));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_json");
    expect(callBackend).not.toHaveBeenCalled();
  });
});
