import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The website's restore routes check the role and pass on. The rules, and their
// tests, are FastAPI's (vertex_be/tests/test_restore.py).
const state = vi.hoisted(() => ({ user: null as { role: string } | null }));
const callBackend = vi.hoisted(() => vi.fn());

vi.mock("@/lib/backend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/backend")>()),
  callBackend: (...args: unknown[]) => callBackend(...args),
}));
vi.mock("@/lib/api-auth", () => ({
  getAuthUser: async () => state.user,
  requireAdmin: (user: { role: string } | null) =>
    !user ? Response.json({}, { status: 401 }) : user.role === "admin" ? null : Response.json({}, { status: 403 }),
}));

const { GET } = await import("@/app/api/admin/deleted/route");
const { POST } = await import("@/app/api/admin/deleted/[table]/[id]/restore/route");

const ok = { ok: true, status: 200, body: { data: [] } };
const list = (query = "") => GET(new NextRequest(`http://localhost/api/admin/deleted${query}`));
const restore = (table: string, id: string) =>
  POST(new NextRequest("http://localhost/x", { method: "POST" }), { params: Promise.resolve({ table, id }) });

describe("deleted record routes", () => {
  beforeEach(() => {
    callBackend.mockReset();
    callBackend.mockResolvedValue(ok);
    state.user = { role: "admin" };
  });

  it("refuse anyone but an admin, before asking FastAPI", async () => {
    state.user = null;
    expect((await list()).status).toBe(401);
    state.user = { role: "finance" };
    expect((await list()).status).toBe(403);
    expect((await restore("User", "u1")).status).toBe(403);
    expect(callBackend).not.toHaveBeenCalled();
  });

  it("pass the filter on", async () => {
    expect((await list("?table=Candidate&limit=5")).status).toBe(200);
    expect(callBackend).toHaveBeenCalledWith("/api/v1/deleted", { query: { table: "Candidate", limit: "5" } });
  });

  it("restore by table and id, encoded", async () => {
    expect((await restore("User", "a/b")).status).toBe(200);
    expect(callBackend).toHaveBeenCalledWith("/api/v1/deleted/User/a%2Fb/restore", { method: "POST" });
  });
});
