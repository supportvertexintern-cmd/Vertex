import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Job writes, the Stripe pricing sync and document-type writes are served
// by FastAPI since backend plan step 3.2, a programme's sectors and
// positions since step 3.3: each handler checks the role
// early, passes the request on and keeps its route's response shapes.
// callBackend() itself is tested in lib/backend.test.ts; e2e/backend.spec.ts
// goes through the real FastAPI.

const state = vi.hoisted(() => ({ role: "marketing" as string | null }));

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

import * as jobs from "@/app/api/jobs/route";
import * as job from "@/app/api/jobs/[id]/route";
import * as sync from "@/app/api/jobs/[id]/sync-stripe-pricing/route";
import * as docTypes from "@/app/api/admin/document-types/route";
import * as docType from "@/app/api/admin/document-types/[id]/route";
import * as sectors from "@/app/api/jobs/[id]/sectors/route";
import * as sector from "@/app/api/jobs/[id]/sectors/[sectorId]/route";
import * as positions from "@/app/api/jobs/[id]/sectors/[sectorId]/positions/route";
import * as position from "@/app/api/jobs/[id]/sectors/[sectorId]/positions/[positionId]/route";

const req = (method = "GET", body?: string) =>
  new NextRequest("http://localhost/api/x", { method, body, headers: body ? { "content-type": "application/json" } : {} });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const JOB = { id: "j1", title: "Farm work", status: "active" };

beforeEach(() => {
  state.role = "marketing";
  callBackend.mockReset();
  callBackend.mockResolvedValue({ ok: true, status: 200, body: { data: JOB } });
});

describe("job writes go to FastAPI and keep their shapes", () => {
  it("POST answers the plain job with 201", async () => {
    callBackend.mockResolvedValueOnce({ ok: true, status: 201, body: { data: JOB } });
    const res = await jobs.POST(req("POST", '{"title":"Farm work"}'));
    expect(callBackend).toHaveBeenCalledWith("/api/v1/jobs", { method: "POST", body: { title: "Farm work" } });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(JOB);
  });

  it("a validation error comes back as { error, details }, as the job forms read it", async () => {
    const details = { payment_stages: ["Payment stage percentages must not exceed 100"] };
    callBackend.mockResolvedValueOnce({ ok: false, status: 422, error: { code: "validation_error", message: "Validation failed", details } });
    const res = await jobs.POST(req("POST", "{}"));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "Validation failed", details });
  });

  it("PUT answers the plain job; a missing one is { error } 404", async () => {
    expect(await (await job.PUT(req("PUT", '{"status":"closed"}'), params("a/b"))).json()).toEqual(JOB);
    expect(callBackend).toHaveBeenCalledWith("/api/v1/jobs/a%2Fb", { method: "PUT", body: { status: "closed" } });

    callBackend.mockResolvedValueOnce({ ok: false, status: 404, error: { code: "not_found", message: "Job not found." } });
    const missing = await job.PUT(req("PUT", "{}"), params("j9"));
    expect([missing.status, await missing.json()]).toEqual([404, { error: "Job not found." }]);
  });

  it("DELETE answers { message }", async () => {
    callBackend.mockResolvedValueOnce({ ok: true, status: 200, body: { data: { id: "j1" } } });
    const res = await job.DELETE(req("DELETE"), params("j1"));
    expect(callBackend).toHaveBeenCalledWith("/api/v1/jobs/j1", { method: "DELETE" });
    expect(await res.json()).toEqual({ message: "Job deleted." });
  });

  it("the manual Stripe sync passes FastAPI's answer on, errors included", async () => {
    const prices = [{ id: "s1", order: 1, stripe_price_id: "price_1" }];
    callBackend.mockResolvedValueOnce({ ok: true, status: 200, body: { data: prices } });
    expect(await (await sync.POST(req("POST"), params("j1"))).json()).toEqual({ data: prices });
    expect(callBackend).toHaveBeenCalledWith("/api/v1/jobs/j1/stripe-pricing/sync", { method: "POST" });

    const error = { code: "stripe_sync_failed", message: "Stripe is down" };
    callBackend.mockResolvedValueOnce({ ok: false, status: 502, error });
    const failed = await sync.POST(req("POST"), params("j1"));
    expect([failed.status, await failed.json()]).toEqual([502, { error }]);
  });
});

describe("document-type writes go to FastAPI", () => {
  beforeEach(() => {
    state.role = "admin";
  });

  it("POST and DELETE pass on", async () => {
    callBackend.mockResolvedValueOnce({ ok: true, status: 201, body: { data: { id: "d1", key: "police_clearance" } } });
    const created = await docTypes.POST(req("POST", '{"label":"Police clearance"}'));
    expect(callBackend).toHaveBeenCalledWith("/api/v1/document-types", { method: "POST", body: { label: "Police clearance" } });
    expect([created.status, await created.json()]).toEqual([201, { data: { id: "d1", key: "police_clearance" } }]);

    callBackend.mockResolvedValueOnce({ ok: true, status: 200, body: { data: { id: "d1" } } });
    await docType.DELETE(req("DELETE"), params("d1"));
    expect(callBackend).toHaveBeenLastCalledWith("/api/v1/document-types/d1", { method: "DELETE" });
  });
});

describe("sector and position writes go to FastAPI", () => {
  const ids = (id: string, sectorId: string, positionId = "") => ({ params: Promise.resolve({ id, sectorId, positionId }) });

  it.each([
    ["POST sector", () => sectors.POST(req("POST", '{"sector":"Agriculture"}'), params("j1")), ["/api/v1/jobs/j1/sectors", { method: "POST", body: { sector: "Agriculture" } }]],
    ["DELETE sector", () => sector.DELETE(req("DELETE"), ids("j1", "s1")), ["/api/v1/jobs/j1/sectors/s1", { method: "DELETE" }]],
    [
      "POST position",
      () => positions.POST(req("POST", '{"title":"Picker"}'), ids("j1", "s1")),
      ["/api/v1/jobs/j1/sectors/s1/positions", { method: "POST", body: { title: "Picker" } }],
    ],
    [
      "PATCH position",
      () => position.PATCH(req("PATCH", '{"city":null}'), ids("j1", "s/1", "p1")),
      ["/api/v1/jobs/j1/sectors/s%2F1/positions/p1", { method: "PATCH", body: { city: null } }],
    ],
    ["DELETE position", () => position.DELETE(req("DELETE"), ids("j1", "s1", "p1")), ["/api/v1/jobs/j1/sectors/s1/positions/p1", { method: "DELETE" }]],
  ])("%s", async (_name, call, expected) => {
    await call();
    expect(callBackend).toHaveBeenCalledWith(...expected);
  });

  it("answers with FastAPI's status and envelope", async () => {
    const error = { code: "duplicate", message: "This sector is already attached to this programme." };
    callBackend.mockResolvedValueOnce({ ok: false, status: 409, error });
    const res = await sectors.POST(req("POST", '{"sector":"Agriculture"}'), params("j1"));
    expect([res.status, await res.json()]).toEqual([409, { error }]);
  });

  it("refuses other roles without calling FastAPI", async () => {
    state.role = "hr";
    expect((await sectors.POST(req("POST", "{}"), params("j1"))).status).toBe(403);
    expect((await position.DELETE(req("DELETE"), ids("j1", "s1", "p1"))).status).toBe(403);
    expect(callBackend).not.toHaveBeenCalled();
  });
});

describe("refuses early, without calling FastAPI", () => {
  it.each([["director"], ["finance"], ["partner"]])("%s can't write jobs or sync pricing", async (role) => {
    state.role = role;
    const calls = [jobs.POST(req("POST", "{}")), job.PUT(req("PUT", "{}"), params("j1")), job.DELETE(req("DELETE"), params("j1")), sync.POST(req("POST"), params("j1"))];
    for (const res of await Promise.all(calls)) expect(res.status).toBe(403);
    expect(callBackend).not.toHaveBeenCalled();
  });

  it("marketing can't write document types", async () => {
    expect((await docTypes.POST(req("POST", "{}"))).status).toBe(403);
    expect((await docType.DELETE(req("DELETE"), params("d1"))).status).toBe(403);
    expect(callBackend).not.toHaveBeenCalled();
  });

  it("a body that isn't JSON", async () => {
    expect((await jobs.POST(req("POST", "{nope"))).status).toBe(400);
    expect((await job.PUT(req("PUT", "{nope"), params("j1"))).status).toBe(400);
    expect(callBackend).not.toHaveBeenCalled();
  });
});
