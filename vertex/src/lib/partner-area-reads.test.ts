import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Reads handover R2: the partner and referral-agent reads come from FastAPI,
// which applies the owner's two decisions (non-managers get partner names
// only; recruiters and country supervisors see only their own candidates of
// a partner) and is tested for them in
// vertex_be/tests/test_partner_area_reads.py. Each handler checks the role
// early and passes the request on with its query.

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

import * as partners from "@/app/api/admin/partners/route";
import * as partner from "@/app/api/admin/partners/[id]/route";
import * as agents from "@/app/api/admin/referral-agents/route";
import * as agent from "@/app/api/admin/referral-agents/[id]/route";
import * as countries from "@/app/api/admin/referral-agents/countries/route";
import * as summary from "@/app/api/admin/referral-agents/countries/[countryId]/summary/route";
import * as performance from "@/app/api/admin/referral-agents/performance/route";
import * as rules from "@/app/api/admin/referral-commission-rules/route";
import * as commissions from "@/app/api/admin/referral-commissions/route";
import * as ownCandidates from "@/app/api/referral-agent/candidates/route";
import * as ownCommissions from "@/app/api/referral-agent/commissions/route";
import * as me from "@/app/api/referral-agent/me/route";

const get = (url: string) => new NextRequest(`http://localhost${url}`);
const ctx = <K extends string>(key: K, value: string) => ({ params: Promise.resolve({ [key]: value } as Record<K, string>) });

beforeEach(() => {
  state.role = "director";
  callBackend.mockReset();
  callBackend.mockResolvedValue({ ok: true, status: 200, body: { data: [{ id: "x" }] } });
});

describe("each read passes on to FastAPI with its query and keeps the { data } shape", () => {
  const cases: [string, () => Promise<Response>, unknown[]][] = [
    ["partners", () => partners.GET(get("/api/admin/partners")), ["/api/v1/partners"]],
    ["a partner", () => partner.GET(get("/api/admin/partners/p%2F1"), ctx("id", "p/1")), ["/api/v1/partners/p%2F1"]],
    ["agents", () => agents.GET(get("/api/admin/referral-agents?countryId=c1")), ["/api/v1/referral-agents", { query: { countryId: "c1" } }]],
    ["an agent", () => agent.GET(get("/api/admin/referral-agents/a1"), ctx("id", "a1")), ["/api/v1/referral-agents/a1"]],
    ["countries", () => countries.GET(get("/api/admin/referral-agents/countries")), ["/api/v1/referral-agents/countries"]],
    ["a country summary", () => summary.GET(get("/x"), ctx("countryId", "c1")), ["/api/v1/referral-agents/countries/c1/summary"]],
    ["performance", () => performance.GET(get("/x")), ["/api/v1/referral-agents/performance", { query: { countryId: undefined } }]],
    ["rules", () => rules.GET(get("/x?countryId=c1")), ["/api/v1/referral-commission-rules", { query: { countryId: "c1" } }]],
    ["commissions", () => commissions.GET(get("/x?agentId=a1&status=pending")), ["/api/v1/referral-commissions", { query: { countryId: undefined, agentId: "a1", status: "pending" } }]],
  ];

  for (const [name, call, args] of cases) {
    it(name, async () => {
      const res = await call();
      expect(callBackend).toHaveBeenCalledWith(...args);
      expect([res.status, await res.json()]).toEqual([200, { data: [{ id: "x" }] }]);
    });
  }

  it("keeps FastAPI's errors", async () => {
    callBackend.mockResolvedValueOnce({ ok: false, status: 404, error: { code: "not_found", message: "Partner not found." } });
    const res = await partner.GET(get("/x"), ctx("id", "p9"));
    expect([res.status, await res.json()]).toEqual([404, { error: { code: "not_found", message: "Partner not found." } }]);
  });
});

describe("a referral agent's own pages", () => {
  beforeEach(() => {
    state.role = "referral_agent";
  });

  it("pass on to the agent's own reads", async () => {
    await ownCandidates.GET(get("/x"));
    await ownCommissions.GET(get("/x"));
    expect(callBackend.mock.calls).toEqual([["/api/v1/referral-agent/candidates"], ["/api/v1/referral-agent/commissions"]]);
  });

  it("/me adds the referral link and its QR code to FastAPI's profile", async () => {
    callBackend.mockResolvedValueOnce({ ok: true, status: 200, body: { data: { id: "a1", referral_code: "REF1" } } });
    const body = await (await me.GET(get("/x"))).json();
    expect(body.data).toMatchObject({ id: "a1", referral_code: "REF1" });
    expect(body.data.referral_link).toMatch(/\/apply\?ref=REF1$/);
    expect(body.data.qr_data_uri).toMatch(/^data:image\/png;base64,/);
  });

  it("/me passes a missing agent record on as is", async () => {
    callBackend.mockResolvedValueOnce({ ok: false, status: 404, error: { code: "not_found", message: "Referral agent record not found." } });
    expect((await me.GET(get("/x"))).status).toBe(404);
  });
});

describe("refuses other roles before calling FastAPI", () => {
  it("referral reads are director and admin only; the agent's own are the agent's", async () => {
    state.role = "finance";
    expect((await agents.GET(get("/x"))).status).toBe(403);
    expect((await commissions.GET(get("/x"))).status).toBe(403);
    expect((await me.GET(get("/x"))).status).toBe(403);
    state.role = "hr";
    expect((await partner.GET(get("/x"), ctx("id", "p1"))).status).toBe(403);
    expect((await partners.GET(get("/x"))).status).toBe(200);
    expect(callBackend).toHaveBeenCalledTimes(1);
  });
});
