import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Reads handover R6: a case's payments, a user's own payments, consultation
// bookings, Finance's payments-due worklist and the staff directory come
// from FastAPI (vertex_be/app/api/v1/payment_reads.py, tested in
// tests/test_payment_reads.py for every role and scope). Each handler checks
// the caller early and passes on; the older shapes (a plain array of one's
// own payments, { error: "message" }) stay as the pages read them.

const state = vi.hoisted(() => ({ role: "finance" as string | null }));

vi.mock("@/lib/api-auth", () => {
  const deny = (status: number) => Response.json({ error: "denied" }, { status });
  return {
    getAuthUser: async () => (state.role ? { userId: "u1", email: "u@test.invalid", role: state.role, sid: "s", ver: 0 } : null),
    requireRole: (user: { role: string } | null, roles: readonly string[]) => (!user ? deny(401) : roles.includes(user.role) ? null : deny(403)),
    requireAuth: (user: unknown) => (user ? null : deny(401)),
    requireAdmin: (user: { role: string } | null) => (!user ? deny(401) : user.role === "admin" ? null : deny(403)),
  };
});

const callBackend = vi.fn();
vi.mock("@/lib/backend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/backend")>()),
  callBackend: (...args: unknown[]) => callBackend(...args),
}));

import * as casePayments from "@/app/api/cases/[id]/payments/route";
import * as mine from "@/app/api/payments/me/route";
import * as bookings from "@/app/api/consultation-bookings/route";
import * as due from "@/app/api/finance/payments-due/route";
import * as users from "@/app/api/admin/users/route";

const get = (query = "") => new NextRequest(`http://localhost/x${query}`);
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const ok = (data: unknown) => ({ ok: true, status: 200, body: { data } });

beforeEach(() => {
  state.role = "finance";
  callBackend.mockReset();
  callBackend.mockResolvedValue(ok([]));
});

describe("the reads pass on and keep their shapes", () => {
  it("lists keep { data }", async () => {
    callBackend.mockResolvedValueOnce(ok([{ case_id: "k1", amountDue: 10 }]));
    expect(await (await due.GET(get())).json()).toEqual({ data: [{ case_id: "k1", amountDue: 10 }] });
    await bookings.GET(get());
    state.role = "director";
    await users.GET(get("?q=ann&role=finance"));
    expect(callBackend.mock.calls.map((c) => c[0])).toEqual(["/api/v1/finance/payments-due", "/api/v1/consultation-bookings", "/api/v1/users"]);
    expect(callBackend.mock.calls[2][1].query).toEqual({ role: "finance", q: "ann" });
  });

  it("a case's payments are { data }, or { error: message }", async () => {
    state.role = "partner";
    callBackend.mockResolvedValueOnce(ok([{ id: "p1" }]));
    expect(await (await casePayments.GET(get(), ctx("k/1"))).json()).toEqual({ data: [{ id: "p1" }] });
    expect(callBackend.mock.calls[0][0]).toBe("/api/v1/cases/k%2F1/payments");
    callBackend.mockResolvedValueOnce({ ok: false, status: 403, error: { code: "forbidden", message: "Forbidden." } });
    const refused = await casePayments.GET(get(), ctx("k1"));
    expect([refused.status, await refused.json()]).toEqual([403, { error: "Forbidden." }]);
  });

  it("one's own payments are a plain array", async () => {
    state.role = "candidate";
    callBackend.mockResolvedValueOnce(ok([{ id: "pay1" }]));
    expect(await (await mine.GET(get())).json()).toEqual([{ id: "pay1" }]);
  });
});

describe("refuses early, without calling FastAPI", () => {
  it("each read is its own audience's", async () => {
    state.role = "hr";
    expect((await due.GET(get())).status).toBe(403);
    expect((await bookings.GET(get())).status).toBe(403);
    expect((await users.GET(get())).status).toBe(403);
    state.role = "candidate";
    expect((await casePayments.GET(get(), ctx("k1"))).status).toBe(403);
    state.role = null;
    expect((await mine.GET(get())).status).toBe(401);
    expect(callBackend).not.toHaveBeenCalled();
  });
});
