import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Reads handover R5: cases, a case's contract and history, exceptions,
// rejected submissions and a document's download link come from FastAPI
// (vertex_be/app/api/v1/case_reads.py, tested in tests/test_case_reads.py
// for every role, scope, filter, and the audit trail functions). Each
// handler checks the caller early and passes its query on; the older shapes
// ({ data } with { error: "message" }) stay as the pages read them.

const state = vi.hoisted(() => ({ role: "operations_team" as string | null }));

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
vi.mock("@/lib/upload", () => ({ getSignedDocumentUrl: async (path: string) => `/api/documents/file?token=signed:${path}` }));

import * as cases from "@/app/api/cases/route";
import * as oneCase from "@/app/api/cases/[id]/route";
import * as contract from "@/app/api/cases/[id]/contract/route";
import * as history from "@/app/api/cases/[id]/audit-log/route";
import * as exceptions from "@/app/api/exceptions/route";
import * as rejected from "@/app/api/rejected-submissions/route";
import * as signedUrl from "@/app/api/documents/[id]/signed-url/route";

const get = (query = "") => new NextRequest(`http://localhost/x${query}`);
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const ok = (data: unknown) => ({ ok: true, status: 200, body: { data } });
const refused = (status: number, message: string) => ({ ok: false, status, error: { code: status === 404 ? "not_found" : "forbidden", message } });

beforeEach(() => {
  state.role = "operations_team";
  callBackend.mockReset();
  callBackend.mockResolvedValue(ok([]));
});

describe("the lists pass their query on and keep { data, ... }", () => {
  it("the case list", async () => {
    const page = { data: [{ id: "k1" }], total: 1, page: 1, pageSize: 50, filter_options: { countries: [] } };
    callBackend.mockResolvedValueOnce({ ok: true, status: 200, body: page });
    const res = await cases.GET(get("?status=all&stage=permit_processing_followup&filterOptions=true&q=ann"));
    expect(await res.json()).toEqual(page);
    const [path, { query }] = callBackend.mock.calls[0];
    expect(path).toBe("/api/v1/cases");
    expect(query).toMatchObject({ status: "all", stage: "permit_processing_followup", filterOptions: "true", q: "ann", page: undefined });
  });

  it("exceptions, rejected submissions and a case's history", async () => {
    state.role = "director";
    await exceptions.GET(get("?escalation_level=country&category=other&page=2"));
    await rejected.GET(get());
    await history.GET(get(), ctx("k/1"));
    expect(callBackend.mock.calls.map((c) => c[0])).toEqual(["/api/v1/exceptions", "/api/v1/rejected-submissions", "/api/v1/cases/k%2F1/audit-log"]);
    expect(callBackend.mock.calls[0][1].query).toMatchObject({ escalation_level: "country", category: "other", page: "2" });
  });
});

describe("the older shapes", () => {
  it("a case and its contract are { data }, or { error: message }", async () => {
    callBackend.mockResolvedValueOnce(ok({ id: "k1" }));
    expect(await (await oneCase.GET(get(), ctx("k1"))).json()).toEqual({ data: { id: "k1" } });
    callBackend.mockResolvedValueOnce(refused(404, "Case not found."));
    const missing = await oneCase.GET(get(), ctx("k1"));
    expect([missing.status, await missing.json()]).toEqual([404, { error: "Case not found." }]);
    callBackend.mockResolvedValueOnce(refused(404, "No contract yet."));
    const none = await contract.GET(get(), ctx("k1"));
    expect([none.status, await none.json()]).toEqual([404, { error: "No contract yet." }]);
  });

  it("a download link is signed here, from FastAPI's storage key", async () => {
    state.role = "candidate";
    callBackend.mockResolvedValueOnce(ok({ storage_path: "passport/a.pdf" }));
    expect(await (await signedUrl.GET(get(), ctx("d1"))).json()).toEqual({ url: "/api/documents/file?token=signed:passport/a.pdf" });
    expect(callBackend.mock.calls[0][0]).toBe("/api/v1/documents/d1/link");
    callBackend.mockResolvedValueOnce(refused(403, "Forbidden."));
    const denied = await signedUrl.GET(get(), ctx("d1"));
    expect([denied.status, await denied.json()]).toEqual([403, { error: "Forbidden." }]);
  });
});

describe("refuses early, without calling FastAPI", () => {
  it("each read is its own audience's", async () => {
    state.role = "marketing";
    expect((await cases.GET(get())).status).toBe(403);
    expect((await history.GET(get(), ctx("k1"))).status).toBe(403);
    state.role = "partner";
    expect((await rejected.GET(get())).status).toBe(403);
    state.role = "hr";
    expect((await exceptions.GET(get())).status).toBe(403);
    state.role = null;
    expect((await contract.GET(get(), ctx("k1"))).status).toBe(401);
    expect((await signedUrl.GET(get(), ctx("d1"))).status).toBe(401);
    expect(callBackend).not.toHaveBeenCalled();
  });
});
