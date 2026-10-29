import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Payments and finance move to FastAPI table by table (step 7,
// docs/architecture/payments-handover.md): each route checks the role and
// JSON early and passes the request on. FastAPI's rules are tested in
// vertex_be/tests (test_referral_commissions.py, …).

const state = vi.hoisted(() => ({ role: "admin" as string | null }));

vi.mock("@/lib/api-auth", () => {
  const deny = (status: number) => Response.json({ error: "denied" }, { status });
  return {
    getAuthUser: async () => (state.role ? { userId: "u1", email: "u@test.invalid", role: state.role, sid: "s", ver: 0 } : null),
    requireRole: (user: { role: string } | null, roles: readonly string[]) => (!user ? deny(401) : roles.includes(user.role) ? null : deny(403)),
  };
});

const callBackend = vi.fn();
vi.mock("@/lib/backend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/backend")>()),
  callBackend: (...args: unknown[]) => callBackend(...args),
}));

import * as rules from "@/app/api/admin/referral-commission-rules/route";

const req = (body?: string) =>
  new NextRequest("http://localhost/api/admin/referral-commission-rules", { method: "POST", body, headers: body ? { "content-type": "application/json" } : {} });

beforeEach(() => {
  state.role = "admin";
  callBackend.mockReset();
  callBackend.mockResolvedValue({ ok: true, status: 200, body: { data: { id: "r1", amount: 25 } } });
});

describe("commission rules (step 7.1)", () => {
  it("passes the upsert on and answers with FastAPI's envelope", async () => {
    const res = await rules.POST(req('{"country_id":"c1","milestone":"qualified","amount":25}'));
    expect(callBackend).toHaveBeenCalledWith("/api/v1/referral-commission-rules", {
      method: "POST",
      body: { country_id: "c1", milestone: "qualified", amount: 25 },
    });
    expect([res.status, await res.json()]).toEqual([200, { data: { id: "r1", amount: 25 } }]);
  });

  it("refuses early: other roles, and a body that isn't JSON", async () => {
    state.role = "hr";
    expect((await rules.POST(req("{}"))).status).toBe(403);
    state.role = "admin";
    expect((await rules.POST(req("{nope"))).status).toBe(400);
    expect(callBackend).not.toHaveBeenCalled();
  });
});
