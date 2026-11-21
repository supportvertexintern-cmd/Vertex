import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The landing editor's routes (/api/content/blocks/...; the landing CMS,
// part 3): any signed-in internal role is passed on to FastAPI, which
// decides by the permissions the admin gave the role (vertex_be
// tests/test_roles.py, tests/test_landing_content.py). External roles stop
// here. A publish clears this server's cached landing page.

const state = vi.hoisted(() => ({ role: "marketing" as string | null }));

vi.mock("@/lib/api-auth", () => {
  const deny = (status: number) => Response.json({ error: "denied" }, { status });
  return {
    getAuthUser: async () => (state.role ? { userId: "u1", email: "u@test.invalid", role: state.role, sid: "s", ver: 0 } : null),
    requireRole: (user: { role: string } | null, roles: string[]) => (!user ? deny(401) : roles.includes(user.role) ? null : deny(403)),
  };
});

const callBackend = vi.fn();
vi.mock("@/lib/backend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/backend")>()),
  callBackend: (...args: unknown[]) => callBackend(...args),
}));

const resetLandingCache = vi.fn();
vi.mock("@/server/services/landingContent", () => ({ resetLandingCache: () => resetLandingCache() }));

import * as list from "@/app/api/content/blocks/route";
import * as one from "@/app/api/content/blocks/[key]/route";
import * as draft from "@/app/api/content/blocks/[key]/draft/route";
import * as publish from "@/app/api/content/blocks/[key]/publish/route";
import * as discard from "@/app/api/content/blocks/[key]/discard/route";
import * as revisions from "@/app/api/content/blocks/[key]/revisions/route";
import * as restore from "@/app/api/content/blocks/[key]/revisions/[number]/restore/route";

const req = (method = "GET", body?: string, url = "http://localhost/api/content/blocks") =>
  new NextRequest(url, { method, body, headers: body ? { "content-type": "application/json" } : {} });
const key = (k: string) => ({ params: Promise.resolve({ key: k }) });

beforeEach(() => {
  state.role = "marketing";
  callBackend.mockReset();
  resetLandingCache.mockReset();
  callBackend.mockResolvedValue({ ok: true, status: 200, body: { data: {} } });
});

describe("the landing editor's routes", () => {
  it("pass each request on to FastAPI", async () => {
    await list.GET(req("GET", undefined, "http://localhost/api/content/blocks?group=web"));
    expect(callBackend).toHaveBeenLastCalledWith("/api/v1/content/blocks", { query: { group: "web" } });
    await one.GET(req(), key("web.hero"));
    expect(callBackend).toHaveBeenLastCalledWith("/api/v1/content/blocks/web.hero", {});
    const body = { body: { title: "T" }, visible: true };
    await draft.PUT(req("PUT", JSON.stringify(body)), key("web.jobs"));
    expect(callBackend).toHaveBeenLastCalledWith("/api/v1/content/blocks/web.jobs/draft", { method: "PUT", body });
    await discard.POST(req("POST"), key("web.jobs"));
    expect(callBackend).toHaveBeenLastCalledWith("/api/v1/content/blocks/web.jobs/discard", { method: "POST" });
    await revisions.GET(req(), key("web.jobs"));
    expect(callBackend).toHaveBeenLastCalledWith("/api/v1/content/blocks/web.jobs/revisions", {});
    await restore.POST(req("POST"), { params: Promise.resolve({ key: "web.jobs", number: "2" }) });
    expect(callBackend).toHaveBeenLastCalledWith("/api/v1/content/blocks/web.jobs/revisions/2/restore", { method: "POST" });
  });

  it("escape a key, so it can't reach another path", async () => {
    await one.GET(req(), key("../../admin/roles"));
    expect(callBackend).toHaveBeenLastCalledWith("/api/v1/content/blocks/..%2F..%2Fadmin%2Froles", {});
  });

  it("clear the cached landing page after a publish, not after a refusal", async () => {
    await publish.POST(req("POST"), key("web.jobs"));
    expect(callBackend).toHaveBeenLastCalledWith("/api/v1/content/blocks/web.jobs/publish", { method: "POST" });
    expect(resetLandingCache).toHaveBeenCalledTimes(1);
    callBackend.mockResolvedValue({ ok: false, status: 403, error: { code: "forbidden", message: "No." } });
    expect((await publish.POST(req("POST"), key("web.jobs"))).status).toBe(403);
    expect(resetLandingCache).toHaveBeenCalledTimes(1);
  });

  it("pass FastAPI's refusal for a missing permission on", async () => {
    state.role = "hr";
    callBackend.mockResolvedValue({ ok: false, status: 403, error: { code: "forbidden", message: "Forbidden." } });
    expect((await draft.PUT(req("PUT", "{}"), key("web.jobs"))).status).toBe(403);
    expect(callBackend).toHaveBeenCalledTimes(1);
  });

  it("refuse bad JSON before FastAPI", async () => {
    expect((await draft.PUT(req("PUT", "{"), key("web.jobs"))).status).toBe(400);
    expect(callBackend).not.toHaveBeenCalled();
  });

  it.each(["partner", "candidate", "referral_agent"])("stop %s, and nobody signed in, before FastAPI", async (role) => {
    state.role = role;
    expect((await list.GET(req())).status).toBe(403);
    expect((await publish.POST(req("POST"), key("web.jobs"))).status).toBe(403);
    state.role = null;
    expect((await list.GET(req())).status).toBe(401);
    expect(callBackend).not.toHaveBeenCalled();
    expect(resetLandingCache).not.toHaveBeenCalled();
  });
});
