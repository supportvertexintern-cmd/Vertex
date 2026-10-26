import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// /api/admin/knowledge and /api/admin/emails are served by FastAPI since
// backend plan step 3.1: each handler checks the role early, passes the
// request on and keeps the old response shapes. callBackend() itself is
// tested in lib/backend.test.ts; e2e/backend.spec.ts goes through the real
// FastAPI.

const state = vi.hoisted(() => ({ role: "admin" as string | null }));

vi.mock("@/lib/api-auth", () => {
  const deny = (status: number) => Response.json({ error: "denied" }, { status });
  return {
    getAuthUser: async () => (state.role ? { userId: "u1", email: "u@test.invalid", role: state.role, sid: "s", ver: 0 } : null),
    requireAdmin: (user: { role: string } | null) => (!user ? deny(401) : user.role === "admin" ? null : deny(403)),
  };
});

const callBackend = vi.fn();
vi.mock("@/lib/backend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/backend")>()),
  callBackend: (...args: unknown[]) => callBackend(...args),
}));

import * as knowledge from "@/app/api/admin/knowledge/route";
import * as emails from "@/app/api/admin/emails/route";

const req = (method = "GET", body?: string, url = "http://localhost/api/admin/x") =>
  new NextRequest(url, { method, body, headers: body ? { "content-type": "application/json" } : {} });
const deleteReq = (query: string) => req("DELETE", undefined, `http://localhost/api/admin/knowledge${query}`);

const ARTICLE = { id: "k1", title: "T", category: "General", content: "C" };
const TEMPLATE = { event: "welcome", subject: "S", body_html: "B" };

beforeEach(() => {
  state.role = "admin";
  callBackend.mockReset();
  callBackend.mockResolvedValue({ ok: true, status: 200, body: { data: [ARTICLE] } });
});

describe("passes each request on to FastAPI, keeping the old shapes", () => {
  it("GET knowledge answers a plain array", async () => {
    const res = await knowledge.GET(req());
    expect(callBackend).toHaveBeenCalledWith("/api/v1/knowledge");
    expect(await res.json()).toEqual([ARTICLE]);
  });

  it("POST knowledge answers the plain article with 201", async () => {
    callBackend.mockResolvedValueOnce({ ok: true, status: 201, body: { data: ARTICLE } });
    const res = await knowledge.POST(req("POST", '{"title":"T","content":"C"}'));
    expect(callBackend).toHaveBeenCalledWith("/api/v1/knowledge", { method: "POST", body: { title: "T", content: "C" } });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(ARTICLE);
  });

  it("DELETE knowledge takes ?id= and answers { success: true }", async () => {
    const res = await knowledge.DELETE(deleteReq("?id=a/b"));
    expect(callBackend).toHaveBeenCalledWith("/api/v1/knowledge/a%2Fb", { method: "DELETE" });
    expect(await res.json()).toEqual({ success: true });
  });

  it("GET and PUT emails answer plain JSON", async () => {
    callBackend.mockResolvedValueOnce({ ok: true, status: 200, body: { data: [TEMPLATE] } });
    expect(await (await emails.GET(req())).json()).toEqual([TEMPLATE]);
    expect(callBackend).toHaveBeenLastCalledWith("/api/v1/email-templates");

    callBackend.mockResolvedValueOnce({ ok: true, status: 200, body: { data: TEMPLATE } });
    expect(await (await emails.PUT(req("PUT", JSON.stringify(TEMPLATE)))).json()).toEqual(TEMPLATE);
    expect(callBackend).toHaveBeenLastCalledWith("/api/v1/email-templates", { method: "PUT", body: TEMPLATE });
  });

  it("passes FastAPI's errors on", async () => {
    const error = { code: "validation_error", message: "Missing required fields" };
    callBackend.mockResolvedValueOnce({ ok: false, status: 400, error });
    const res = await emails.PUT(req("PUT", "{}"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
  });
});

describe("refuses early, without calling FastAPI", () => {
  it.each([["director"], ["marketing"], ["candidate"]])("%s", async (role) => {
    state.role = role;
    const calls = [
      knowledge.GET(req()),
      knowledge.POST(req("POST", "{}")),
      knowledge.DELETE(deleteReq("?id=k1")),
      emails.GET(req()),
      emails.PUT(req("PUT", "{}")),
    ];
    for (const res of await Promise.all(calls)) expect(res.status).toBe(403);
    expect(callBackend).not.toHaveBeenCalled();
  });

  it("a delete without an id, or a body that isn't JSON", async () => {
    expect((await knowledge.DELETE(deleteReq(""))).status).toBe(400);
    expect((await knowledge.POST(req("POST", "{nope"))).status).toBe(400);
    expect((await emails.PUT(req("PUT", "{nope"))).status).toBe(400);
    expect(callBackend).not.toHaveBeenCalled();
  });
});
