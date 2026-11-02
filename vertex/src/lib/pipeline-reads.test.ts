import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Reads handover R4: the candidate pipeline's reads come from FastAPI
// (vertex_be/app/api/v1/pipeline_reads.py, tested in
// tests/test_pipeline_reads.py for every role, scope, filter and the Q2/Q3
// decisions). Each handler checks the caller early and passes its query on;
// the older shapes (a plain profile, a plain application, a candidate's
// plain list, { error }) stay as the pages read them.

const state = vi.hoisted(() => ({ role: "hr" as string | null }));

vi.mock("@/lib/api-auth", () => {
  const deny = (status: number) => Response.json({ error: "denied" }, { status });
  return {
    getAuthUser: async () => (state.role ? { userId: "u1", email: "u@test.invalid", role: state.role, sid: "s", ver: 0 } : null),
    requireRole: (user: { role: string } | null, roles: readonly string[]) => (!user ? deny(401) : roles.includes(user.role) ? null : deny(403)),
    requireAuth: (user: unknown) => (user ? null : deny(401)),
  };
});

const callBackend = vi.fn();
vi.mock("@/lib/backend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/backend")>()),
  callBackend: (...args: unknown[]) => callBackend(...args),
}));

import * as candidates from "@/app/api/candidates/route";
import * as candidate from "@/app/api/candidates/[id]/route";
import * as messages from "@/app/api/candidates/[id]/messages/route";
import * as profile from "@/app/api/candidates/profile/route";
import * as applications from "@/app/api/applications/route";
import * as application from "@/app/api/applications/[id]/route";
import * as partnerOwn from "@/app/api/partner/candidates/route";
import * as partnerOne from "@/app/api/partner/candidates/[id]/route";
import * as queue from "@/app/api/partner-candidates/route";
import * as submission from "@/app/api/partner-candidates/[id]/route";

const get = (query = "") => new NextRequest(`http://localhost/x${query}`);
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const ok = (data: unknown, extra: Record<string, unknown> = {}) => ({ ok: true, status: 200, body: { data, ...extra } });

beforeEach(() => {
  state.role = "hr";
  callBackend.mockReset();
  callBackend.mockResolvedValue(ok([{ id: "x" }]));
});

describe("the staff reads pass their query on and keep { data, ... }", () => {
  it("the candidate list", async () => {
    const page = { data: [{ id: "c1" }], total: 1, page: 1, pageSize: 15, summary: { awaiting_reply_count: 0 } };
    callBackend.mockResolvedValueOnce({ ok: true, status: 200, body: page });
    const res = await candidates.GET(get("?q=ann&signals=true&source=self_registered,referral_sourced"));
    expect(await res.json()).toEqual(page);
    const [path, { query }] = callBackend.mock.calls[0];
    expect(path).toBe("/api/v1/candidates");
    expect(query).toMatchObject({ q: "ann", signals: "true", source: "self_registered,referral_sourced", page: undefined });
  });

  it("one candidate, its thread, the queue and one submission", async () => {
    await candidate.GET(get(), ctx("c/1"));
    await messages.GET(get(), ctx("c1"));
    await queue.GET(get("?status=submitted"));
    await submission.GET(get(), ctx("pc1"));
    expect(callBackend.mock.calls.map((c) => c[0])).toEqual([
      "/api/v1/candidates/c%2F1", "/api/v1/candidates/c1/messages", "/api/v1/partner-candidates", "/api/v1/partner-candidates/pc1",
    ]);
    expect(callBackend.mock.calls[2][1].query).toMatchObject({ status: "submitted" });
  });
});

describe("the older shapes", () => {
  it("the profile is the plain record, or { error } 404", async () => {
    callBackend.mockResolvedValueOnce(ok({ id: "c1" }));
    expect(await (await profile.GET(get())).json()).toEqual({ id: "c1" });
    callBackend.mockResolvedValueOnce({ ok: false, status: 404, error: { code: "not_found", message: "Profile not found." } });
    const missing = await profile.GET(get());
    expect([missing.status, await missing.json()]).toEqual([404, { error: "Profile not found." }]);
  });

  it("a candidate's own applications are a plain array, or { applications: [] }", async () => {
    state.role = "candidate";
    callBackend.mockResolvedValueOnce(ok([{ id: "a1" }]));
    expect(await (await applications.GET(get())).json()).toEqual([{ id: "a1" }]);
    callBackend.mockResolvedValueOnce(ok(null));
    expect(await (await applications.GET(get())).json()).toEqual({ applications: [] });
  });

  it("staff applications keep the page", async () => {
    state.role = "country_supervisor";
    const page = { data: [], total: 0, page: 2, pageSize: 50 };
    callBackend.mockResolvedValueOnce({ ok: true, status: 200, body: page });
    expect(await (await applications.GET(get("?page=2"))).json()).toEqual(page);
    expect(callBackend).toHaveBeenCalledWith("/api/v1/applications", { query: { page: "2", pageSize: undefined } });
  });

  it("an application is the plain row, or { error } (Q3's refusal included)", async () => {
    state.role = "inhouse_supervisor";
    callBackend.mockResolvedValueOnce({ ok: false, status: 403, error: { code: "forbidden", message: "Forbidden." } });
    const refused = await application.GET(get(), ctx("a1"));
    expect([refused.status, await refused.json()]).toEqual([403, { error: "Forbidden." }]);
    callBackend.mockResolvedValueOnce(ok({ id: "a1" }));
    expect(await (await application.GET(get(), ctx("a1"))).json()).toEqual({ id: "a1" });
  });
});

describe("refuses early, without calling FastAPI", () => {
  it("each read is its own audience's", async () => {
    state.role = "partner";
    expect((await candidates.GET(get())).status).toBe(403);
    expect((await queue.GET(get())).status).toBe(403);
    state.role = "hr";
    expect((await partnerOwn.GET(get())).status).toBe(403);
    expect((await partnerOne.GET(get(), ctx("p1"))).status).toBe(403);
    state.role = null;
    expect((await application.GET(get(), ctx("a1"))).status).toBe(401);
    expect((await messages.GET(get(), ctx("c1"))).status).toBe(401);
    expect(callBackend).not.toHaveBeenCalled();
  });
});
