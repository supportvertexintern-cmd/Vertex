import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// /api/admin/settings is served by FastAPI since backend plan step 2.3: the
// handler checks the role early, passes the request on and keeps the old
// response shapes (a plain map; { success: true }). callBackend() itself is
// tested in lib/backend.test.ts; e2e/backend.spec.ts goes through the real
// FastAPI.

const state = vi.hoisted(() => ({ role: "admin" as string | null }));

vi.mock("@/lib/api-auth", () => {
  const deny = (status: number) => Response.json({ error: "denied" }, { status });
  return {
    getAuthUser: async () => (state.role ? { userId: "u1", email: "u@test.invalid", role: state.role, sid: "s", ver: 0 } : null),
    requireAdmin: (user: { role: string } | null) => (!user ? deny(401) : user.role === "admin" ? null : deny(403)),
  };
});

const callBackend = vi.fn();
vi.mock("@/lib/backend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/backend")>()),
  callBackend: (...args: unknown[]) => callBackend(...args),
}));

import * as settings from "@/app/api/admin/settings/route";

const req = (method = "GET", body?: string) =>
  new NextRequest("http://localhost/api/admin/settings", { method, body, headers: body ? { "content-type": "application/json" } : {} });

const MAP = { ai_enabled: "true", intake_mode: "crm" };

beforeEach(() => {
  state.role = "admin";
  callBackend.mockReset();
  callBackend.mockResolvedValue({ ok: true, status: 200, body: { data: MAP } });
});

describe("passes each request on to FastAPI", () => {
  it("GET answers the plain key-value map", async () => {
    const res = await settings.GET(req());
    expect(callBackend).toHaveBeenCalledWith("/api/v1/settings");
    expect(await res.json()).toEqual(MAP);
  });

  it("PUT sends the body and answers { success: true }", async () => {
    const res = await settings.PUT(req("PUT", '{"intake_mode":"email"}'));
    expect(callBackend).toHaveBeenCalledWith("/api/v1/settings", { method: "PUT", body: { intake_mode: "email" } });
    expect(await res.json()).toEqual({ success: true });
  });

  it("passes FastAPI's errors on", async () => {
    const error = { code: "validation_error", message: "intake_mode must be 'email' or 'crm'" };
    callBackend.mockResolvedValueOnce({ ok: false, status: 400, error });
    const res = await settings.PUT(req("PUT", '{"intake_mode":"fax"}'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
  });
});

describe("refuses early, without calling FastAPI", () => {
  it.each([["director"], ["hr"], ["candidate"]])("%s", async (role) => {
    state.role = role;
    expect((await settings.GET(req())).status).toBe(403);
    expect((await settings.PUT(req("PUT", "{}"))).status).toBe(403);
    expect(callBackend).not.toHaveBeenCalled();
  });

  it("a signed-out visitor", async () => {
    state.role = null;
    expect((await settings.GET(req())).status).toBe(401);
    expect(callBackend).not.toHaveBeenCalled();
  });

  it("a body that isn't JSON", async () => {
    expect((await settings.PUT(req("PUT", "{nope"))).status).toBe(400);
    expect(callBackend).not.toHaveBeenCalled();
  });
});
