import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// /api/admin/roles and /api/admin/roles/:role/permissions (role management,
// 2026-11-21) are served by FastAPI (vertex_be/app/api/v1/roles.py): each
// handler checks for admin early and passes the request on. FastAPI's own
// rules (admin unchangeable, external roles refused) are its tests'; the
// journey e2e/roles.spec.ts goes through the real FastAPI.

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

import * as roles from "@/app/api/admin/roles/route";
import * as rolePermissions from "@/app/api/admin/roles/[role]/permissions/route";

const req = (method = "GET", body?: string) =>
  new NextRequest("http://localhost/api/admin/roles", { method, body, headers: body ? { "content-type": "application/json" } : {} });
const params = (role: string) => ({ params: Promise.resolve({ role }) });

beforeEach(() => {
  state.role = "admin";
  callBackend.mockReset();
  callBackend.mockResolvedValue({ ok: true, status: 200, body: { data: { permissions: [], roles: [] } } });
});

describe("role management routes", () => {
  it("GET passes on to FastAPI for an admin", async () => {
    const res = await roles.GET(req());
    expect(res.status).toBe(200);
    expect(callBackend).toHaveBeenCalledWith("/api/v1/admin/roles");
  });

  it("PUT passes the role, escaped, and the body on", async () => {
    const body = { permissions: ["landing.edit"] };
    await rolePermissions.PUT(req("PUT", JSON.stringify(body)), params("hr"));
    expect(callBackend).toHaveBeenCalledWith("/api/v1/admin/roles/hr/permissions", { method: "PUT", body });
    await rolePermissions.PUT(req("PUT", JSON.stringify(body)), params("../users"));
    expect(callBackend).toHaveBeenLastCalledWith("/api/v1/admin/roles/..%2Fusers/permissions", { method: "PUT", body });
  });

  it("passes FastAPI's refusal on as it is", async () => {
    callBackend.mockResolvedValue({ ok: false, status: 400, error: { code: "role_not_assignable", message: "Only internal roles can be given permissions." } });
    const res = await rolePermissions.PUT(req("PUT", JSON.stringify({ permissions: [] })), params("partner"));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("role_not_assignable");
  });

  it("refuses bad JSON without asking FastAPI", async () => {
    const res = await rolePermissions.PUT(req("PUT", "{"), params("hr"));
    expect(res.status).toBe(400);
    expect(callBackend).not.toHaveBeenCalled();
  });

  it.each(["marketing", "director", "hr", "partner"])("refuses %s, and nobody signed in, before FastAPI", async (role) => {
    state.role = role;
    expect((await roles.GET(req())).status).toBe(403);
    expect((await rolePermissions.PUT(req("PUT", "{}"), params("hr"))).status).toBe(403);
    state.role = null;
    expect((await roles.GET(req())).status).toBe(401);
    expect(callBackend).not.toHaveBeenCalled();
  });
});
