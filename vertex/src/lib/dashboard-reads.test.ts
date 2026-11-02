import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Reads handover R3: the dashboards and report reads come from FastAPI
// (vertex_be/app/api/v1/dashboards.py, tested in tests/test_dashboards.py
// for every role, scope and number). Each handler checks the role early and
// passes its query on; the paged ones keep { data, total, page, pageSize }.

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

import * as kpi from "@/app/api/kpi/route";
import * as progress from "@/app/api/recruiter-targets/progress/route";
import * as overview from "@/app/api/supervisor/overview/route";
import * as recruiters from "@/app/api/supervisor/recruiters/route";
import * as recruiter from "@/app/api/supervisor/recruiters/[id]/route";
import * as teamTargets from "@/app/api/supervisor/team-targets/route";
import * as inhouseOverview from "@/app/api/inhouse/overview/route";
import * as inhouseCampaigns from "@/app/api/inhouse/campaigns/route";
import * as inhouseSupervisors from "@/app/api/inhouse/supervisors/route";
import * as inhouseSupervisor from "@/app/api/inhouse/supervisors/[id]/route";
import * as metrics from "@/app/api/management/report-metrics/route";
import * as reports from "@/app/api/reports/route";
import * as report from "@/app/api/reports/[id]/route";
import * as preview from "@/app/api/reports/consolidation-preview/route";
import * as staffTargets from "@/app/api/staff-kpi-targets/route";

const get = (query = "") => new NextRequest(`http://localhost/x${query}`);
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const DATA = { data: { ok: true } };

beforeEach(() => {
  state.role = "admin";
  callBackend.mockReset();
  callBackend.mockResolvedValue({ ok: true, status: 200, body: DATA });
});

describe("each read passes on to FastAPI with its query", () => {
  const cases: [string, () => Promise<Response>, unknown[]][] = [
    ["kpi", () => kpi.GET(get("?period_start=2026-01-01&campaign_id=c1")), ["/api/v1/kpi", { query: { period_start: "2026-01-01", period_end: undefined, country_id: undefined, region_id: undefined, recruiter_id: undefined, campaign_id: "c1" } }]],
    ["supervisor overview", () => overview.GET(get("?period_start=a&period_end=b")), ["/api/v1/supervisor/overview", { query: { period_start: "a", period_end: "b" } }]],
    ["supervisor recruiters", () => recruiters.GET(get()), ["/api/v1/supervisor/recruiters", { query: { period_start: undefined, period_end: undefined } }]],
    ["a recruiter", () => recruiter.GET(get(), ctx("r/1")), ["/api/v1/supervisor/recruiters/r%2F1", { query: { period_start: undefined, period_end: undefined } }]],
    ["team targets", () => teamTargets.GET(get()), ["/api/v1/supervisor/team-targets"]],
    ["inhouse overview", () => inhouseOverview.GET(get()), ["/api/v1/inhouse/overview"]],
    ["inhouse campaigns", () => inhouseCampaigns.GET(get()), ["/api/v1/inhouse/campaigns"]],
    ["inhouse supervisors", () => inhouseSupervisors.GET(get()), ["/api/v1/inhouse/supervisors", { query: { period_start: undefined, period_end: undefined } }]],
    ["an inhouse supervisor", () => inhouseSupervisor.GET(get(), ctx("s1")), ["/api/v1/inhouse/supervisors/s1"]],
    ["a report", () => report.GET(get(), ctx("rep1")), ["/api/v1/reports/rep1"]],
    ["consolidation preview", () => preview.GET(get("?type=weekly")), ["/api/v1/reports/consolidation-preview", { query: { type: "weekly", period_start: undefined, period_end: undefined } }]],
    ["staff KPI targets", () => staffTargets.GET(get("?cycle=weekly")), ["/api/v1/staff-kpi-targets", { query: { staff_id: undefined, cycle: "weekly" } }]],
  ];

  for (const [name, call, args] of cases) {
    it(name, async () => {
      const res = await call();
      expect(callBackend).toHaveBeenCalledWith(...args);
      expect([res.status, await res.json()]).toEqual([200, DATA]);
    });
  }

  it("the paged reads keep total, page and pageSize", async () => {
    const page = { data: [{ id: "r1" }], total: 1, page: 2, pageSize: 50 };
    callBackend.mockResolvedValue({ ok: true, status: 200, body: page });
    expect(await (await reports.GET(get("?page=2&q=ann"))).json()).toEqual(page);
    expect(callBackend).toHaveBeenLastCalledWith("/api/v1/reports", {
      query: { country_id: undefined, type: undefined, status: undefined, recruiter_id: undefined, scope_level: undefined, q: "ann", page: "2", pageSize: undefined },
    });
    expect(await (await metrics.GET(get("?cadence=monthly"))).json()).toEqual(page);
  });

  it("keeps FastAPI's errors", async () => {
    callBackend.mockResolvedValueOnce({ ok: false, status: 422, error: { code: "validation_error", message: "period_start and period_end are required." } });
    const res = await overview.GET(get());
    expect([res.status, (await res.json()).error.code]).toEqual([422, "validation_error"]);
  });
});

describe("refuses other roles before calling FastAPI", () => {
  it("each dashboard is its own tier's", async () => {
    state.role = "regional_recruiter";
    expect((await kpi.GET(get())).status).toBe(403);
    expect((await overview.GET(get())).status).toBe(403);
    expect((await inhouseOverview.GET(get())).status).toBe(403);
    expect((await metrics.GET(get())).status).toBe(403);
    expect((await progress.GET(get())).status).toBe(200);
    state.role = "finance";
    expect((await reports.GET(get())).status).toBe(403);
    expect(callBackend).toHaveBeenCalledTimes(1);
  });
});
