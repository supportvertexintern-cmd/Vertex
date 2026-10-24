import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// /api/fee-policy is served by FastAPI since backend plan steps 1.2 (writes)
// and 1.3 (reads): this route checks the role early and passes the request
// on. callBackend() itself is tested in lib/backend.test.ts.

const state = vi.hoisted(() => ({ role: "finance" as string | null }));

vi.mock("@/lib/api-auth", () => ({
  getAuthUser: async () => (state.role ? { userId: "u1", email: "u@test.invalid", role: state.role, sid: "s", ver: 0 } : null),
  requireRole: (user: { role: string } | null, roles: string[]) =>
    !user
      ? Response.json({ error: "Unauthorized. Please log in." }, { status: 401 })
      : roles.includes(user.role)
        ? null
        : Response.json({ error: "Forbidden. Insufficient role." }, { status: 403 }),
}));

const callBackend = vi.fn();
vi.mock("@/lib/backend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/backend")>()),
  callBackend: (...args: unknown[]) => callBackend(...args),
}));

import { GET, POST } from "@/app/api/fee-policy/route";

const page = { data: [{ id: "p1", country_id: null, enabled: true, country: null }] };

beforeEach(() => {
  state.role = "finance";
  callBackend.mockReset();
});

describe("GET /api/fee-policy", () => {
  it("answers with FastAPI's response, status and body unchanged", async () => {
    callBackend.mockResolvedValue({ ok: true, status: 200, body: page });
    const res = await GET(new NextRequest("http://localhost/api/fee-policy"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(page);
    expect(callBackend).toHaveBeenCalledWith("/api/v1/fee-policy");
  });

  it("passes FastAPI's errors on (e.g. it's unavailable)", async () => {
    callBackend.mockResolvedValue({ ok: false, status: 503, error: { code: "backend_unavailable", message: "x" } });
    const res = await GET(new NextRequest("http://localhost/api/fee-policy"));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("backend_unavailable");
  });

  it.each([["candidate"], ["marketing"], ["referral_agent"]])("refuses %s without calling FastAPI", async (role) => {
    state.role = role;
    expect((await GET(new NextRequest("http://localhost/api/fee-policy"))).status).toBe(403);
    expect(callBackend).not.toHaveBeenCalled();
  });

  it("refuses no session without calling FastAPI", async () => {
    state.role = null;
    expect((await GET(new NextRequest("http://localhost/api/fee-policy"))).status).toBe(401);
    expect(callBackend).not.toHaveBeenCalled();
  });
});

describe("POST /api/fee-policy", () => {
  const post = (body: string) => new NextRequest("http://localhost/api/fee-policy", { method: "POST", body, headers: { "content-type": "application/json" } });

  it("passes the body on for a manager", async () => {
    state.role = "director";
    callBackend.mockResolvedValue({ ok: true, status: 200, body: { data: { id: "p1" } } });
    const res = await POST(post('{"enabled":true}'));
    expect(res.status).toBe(200);
    expect(callBackend).toHaveBeenCalledWith("/api/v1/fee-policy", { method: "POST", body: { enabled: true } });
  });

  it("refuses a reader who isn't a manager without calling FastAPI", async () => {
    expect((await POST(post('{"enabled":true}'))).status).toBe(403);
    expect(callBackend).not.toHaveBeenCalled();
  });

  it("refuses a body that isn't JSON", async () => {
    state.role = "admin";
    const res = await POST(post("{not json"));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_json");
  });
});
