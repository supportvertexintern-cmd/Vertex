import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// /api/admin/sectors and /api/admin/countries/[id]/document-requirements are
// served by FastAPI since backend plan step 2.2: each handler checks the
// role early and passes the request on. callBackend() itself is tested in
// lib/backend.test.ts; e2e/backend.spec.ts goes through the real FastAPI.

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

import * as sectors from "@/app/api/admin/sectors/route";
import * as sector from "@/app/api/admin/sectors/[id]/route";
import * as requirements from "@/app/api/admin/countries/[id]/document-requirements/route";

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
    ["GET sectors", () => sectors.GET(req()), ["/api/v1/sectors"]],
    ["POST sectors", () => sectors.POST(req("POST", '{"name":"Care"}')), ["/api/v1/sectors", { method: "POST", body: { name: "Care" } }]],
    ["DELETE sector", () => sector.DELETE(req("DELETE"), params("s1")), ["/api/v1/sectors/s1", { method: "DELETE" }]],
    ["GET requirements", () => requirements.GET(req(), params("c1")), ["/api/v1/countries/c1/document-requirements"]],
    [
      "PUT requirements",
      () => requirements.PUT(req("PUT", '{"document_types":["passport"]}'), params("c1")),
      ["/api/v1/countries/c1/document-requirements", { method: "PUT", body: { document_types: ["passport"] } }],
    ],
  ])("%s", async (_name, call, expected) => {
    await call();
    expect(callBackend).toHaveBeenCalledWith(...expected);
  });

  it("answers with FastAPI's status and body", async () => {
    callBackend.mockResolvedValueOnce({ ok: true, status: 201, body: { data: { id: "s9", name: "Care" } } });
    const created = await sectors.POST(req("POST", '{"name":"Care"}'));
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ data: { id: "s9", name: "Care" } });

    const error = { code: "unknown_type", message: "One or more document types don't exist." };
    callBackend.mockResolvedValueOnce({ ok: false, status: 422, error });
    const bad = await requirements.PUT(req("PUT", '{"document_types":["nope"]}'), params("c1"));
    expect(bad.status).toBe(422);
    expect(await bad.json()).toEqual({ error });
  });

  it("keeps an id with odd characters inside its path segment", async () => {
    await requirements.GET(req(), params("a/b"));
    expect(callBackend).toHaveBeenCalledWith("/api/v1/countries/a%2Fb/document-requirements");
  });
});

describe("refuses early, without calling FastAPI", () => {
  it("a candidate reads requirements but not sectors", async () => {
    state.role = "candidate";
    expect((await sectors.GET(req())).status).toBe(403);
    await requirements.GET(req(), params("c1"));
    expect(callBackend).toHaveBeenCalledTimes(1);
  });

  it.each([["hr"], ["finance"], ["partner"]])("%s reads neither", async (role) => {
    state.role = role;
    expect((await sectors.GET(req())).status).toBe(403);
    expect((await requirements.GET(req(), params("c1"))).status).toBe(403);
    expect(callBackend).not.toHaveBeenCalled();
  });

  it("writes for anyone but admin", async () => {
    state.role = "director";
    const writes = [sectors.POST(req("POST", "{}")), sector.DELETE(req("DELETE"), params("s1")), requirements.PUT(req("PUT", "{}"), params("c1"))];
    for (const res of await Promise.all(writes)) expect(res.status).toBe(403);
    expect(callBackend).not.toHaveBeenCalled();
  });

  it("a body that isn't JSON", async () => {
    const res = await requirements.PUT(req("PUT", "{nope"), params("c1"));
    expect(res.status).toBe(400);
    expect(callBackend).not.toHaveBeenCalled();
  });
});
