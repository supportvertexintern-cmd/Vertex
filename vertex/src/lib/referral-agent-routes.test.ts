import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Referral-agent targets are saved by FastAPI since users and sessions step
// 8.1: the POST checks the role early and passes the request on; the
// target-vs-actual GET still reads here. callBackend() itself is tested in
// lib/backend.test.ts.

const state = vi.hoisted(() => ({ role: "director" as string | null }));

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

const actuals = vi.fn();
vi.mock("@/server/services/kpi", () => ({ computeReferralAgentTargetsVsActuals: (...args: unknown[]) => actuals(...args) }));

import * as targets from "@/app/api/admin/referral-agents/[id]/targets/route";

const ctx = { params: Promise.resolve({ id: "agent1" }) };
const post = (body?: string) =>
  targets.POST(new NextRequest("http://localhost/api/admin/referral-agents/agent1/targets", { method: "POST", body, headers: body ? { "content-type": "application/json" } : {} }), ctx);
const row = { id: "t1", referral_agent_id: "agent1", target_referrals: 12 };

beforeEach(() => {
  state.role = "director";
  callBackend.mockReset();
  actuals.mockReset();
});

describe("referral-agent targets (step 8.1)", () => {
  it("passes a target on to FastAPI and answers with its response", async () => {
    callBackend.mockResolvedValueOnce({ ok: true, status: 201, body: { data: row } });
    const res = await post('{"period_start":"2026-11-01","period_end":"2026-11-30","target_referrals":12}');
    expect(callBackend).toHaveBeenCalledWith("/api/v1/referral-agents/agent1/targets", {
      method: "POST",
      body: { period_start: "2026-11-01", period_end: "2026-11-30", target_referrals: 12 },
    });
    expect([res.status, await res.json()]).toEqual([201, { data: row }]);
  });

  it("keeps FastAPI's errors as { error: { code, message } }", async () => {
    callBackend.mockResolvedValueOnce({ ok: false, status: 404, error: { code: "not_found", message: "Referral agent not found." } });
    const res = await post("{}");
    expect([res.status, await res.json()]).toEqual([404, { error: { code: "not_found", message: "Referral agent not found." } }]);
  });

  it("refuses other roles and bad JSON before calling FastAPI", async () => {
    const bad = await post("{not json");
    expect([bad.status, await bad.json()]).toEqual([400, { error: { code: "invalid_json", message: "Invalid JSON" } }]);
    state.role = "finance";
    expect((await post("{}")).status).toBe(403);
    state.role = null;
    expect((await post("{}")).status).toBe(401);
    expect(callBackend).not.toHaveBeenCalled();
  });

  it("the target-vs-actual read stays here", async () => {
    actuals.mockResolvedValueOnce([{ period_start: "2026-11-01", target: 12, actual: 3 }]);
    const res = await targets.GET(new NextRequest("http://localhost/api/admin/referral-agents/agent1/targets"), ctx);
    expect(actuals).toHaveBeenCalledWith("agent1");
    expect(await res.json()).toEqual({ data: [{ period_start: "2026-11-01", target: 12, actual: 3 }] });
    expect(callBackend).not.toHaveBeenCalled();
  });
});
