// GET /api/auth/me since R7d: the website checks only the token's signature,
// so whether the session is live is FastAPI's answer (G19).
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ user: null as null | { userId: string; email: string; role: string; sid: string; ver: number } }));

const callBackend = vi.fn();
vi.mock("@/lib/backend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/backend")>()),
  callBackend: (...args: unknown[]) => callBackend(...args),
}));
vi.mock("@/lib/api-auth", () => ({ getAuthUser: async () => state.user }));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/auth/me/route";

const ask = () => GET(new NextRequest("http://test/api/auth/me"));

beforeEach(() => {
  state.user = { userId: "u1", email: "a@test.invalid", role: "admin", sid: "s1", ver: 0 };
  callBackend.mockReset();
});

describe("GET /api/auth/me", () => {
  it("no valid token is nobody, without asking FastAPI", async () => {
    state.user = null;
    const res = await ask();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ data: null });
    expect(callBackend).not.toHaveBeenCalled();
  });

  it("a signed token whose session FastAPI refuses is nobody", async () => {
    callBackend.mockResolvedValue({ ok: false, status: 401, error: { code: "unauthorized", message: "x" } });
    const res = await ask();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ data: null });
    expect(callBackend).toHaveBeenCalledWith("/api/v1/me");
  });

  it("a live session is FastAPI's view of the user", async () => {
    callBackend.mockResolvedValue({ ok: true, status: 200, body: { data: { id: "u1", email: "a@test.invalid", role: "hr" } } });
    const res = await ask();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { userId: "u1", email: "a@test.invalid", role: "hr" } });
  });

  it("FastAPI unreachable is its error, not signed out", async () => {
    callBackend.mockResolvedValue({ ok: false, status: 502, error: { code: "unavailable", message: "x" } });
    expect((await ask()).status).toBe(502);
  });
});
