// Address controls (login protection PR 5): the website reads an admin's
// blocks and allows from FastAPI at most once a minute, matches addresses
// and ranges (IPv4 and IPv6), lets a block win over an allow, keeps the last
// list when FastAPI can't be asked, and refuses a blocked address on the
// sign-in, registration and reset routes before anything else happens.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rules: [] as { network: string; kind: "block" | "allow" }[],
  fail: false,
  calls: 0,
}));

const callBackend = vi.fn(async (path: string) => {
  if (path === "/api/v1/address-controls") {
    state.calls += 1;
    return state.fail
      ? { ok: false, status: 503, error: { code: "backend_unavailable", message: "down" } }
      : { ok: true, status: 200, body: { data: state.rules } };
  }
  return { ok: true, status: 200, body: { data: {} } };
});
vi.mock("./backend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./backend")>()),
  callBackend: (path: string) => callBackend(path),
}));
vi.mock("./log", () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { isAllowed, isBlocked, refuseBlocked, resetAddressControls } from "./address-controls";

beforeEach(() => {
  vi.stubEnv("BACKEND_URL", "http://backend:8000");
  vi.stubEnv("TRUST_PROXY_HEADERS", "true");
  state.rules = [];
  state.fail = false;
  state.calls = 0;
  resetAddressControls();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("matching", () => {
  it("addresses and ranges, IPv4 and IPv6; a block wins over an allow", async () => {
    state.rules = [
      { network: "198.51.100.7/32", kind: "block" },
      { network: "203.0.113.0/24", kind: "allow" },
      { network: "203.0.113.9/32", kind: "block" },
      { network: "2001:db8::/64", kind: "allow" },
    ];
    expect(await isBlocked("198.51.100.7")).toBe(true);
    expect(await isBlocked("198.51.100.8")).toBe(false);
    expect(await isAllowed("203.0.113.50")).toBe(true);
    expect(await isAllowed("203.0.113.9")).toBe(false); // blocked inside an allowed range
    expect(await isBlocked("203.0.113.9")).toBe(true);
    expect(await isAllowed("2001:db8::1")).toBe(true);
    expect(await isAllowed("2001:db9::1")).toBe(false);
    expect(await isBlocked("direct")).toBe(false); // no address known
  });
});

describe("the list", () => {
  it("is read at most once a minute", async () => {
    vi.useFakeTimers();
    await isBlocked("198.51.100.1");
    await isBlocked("198.51.100.2");
    expect(state.calls).toBe(1);
    vi.advanceTimersByTime(61_000);
    await isBlocked("198.51.100.3");
    expect(state.calls).toBe(2);
  });

  it("stands when FastAPI can't be asked; with none yet, nothing is blocked", async () => {
    vi.useFakeTimers();
    state.fail = true;
    expect(await isBlocked("198.51.100.7")).toBe(false);
    state.fail = false;
    state.rules = [{ network: "198.51.100.7/32", kind: "block" }];
    vi.advanceTimersByTime(11_000); // a failure is retried after 10 seconds
    expect(await isBlocked("198.51.100.7")).toBe(true);
    state.fail = true;
    vi.advanceTimersByTime(61_000);
    expect(await isBlocked("198.51.100.7")).toBe(true); // the last list stands
  });

  it("isn't asked for without FastAPI", async () => {
    vi.stubEnv("BACKEND_URL", "");
    state.rules = [{ network: "198.51.100.7/32", kind: "block" }];
    expect(await isBlocked("198.51.100.7")).toBe(false);
    expect(state.calls).toBe(0);
  });
});

describe("blocked routes", () => {
  const from = (ip: string, path: string, init: RequestInit = {}) =>
    new Request(`http://localhost${path}`, { ...init, headers: { "x-real-ip": ip, "content-type": "application/json", ...(init.headers ?? {}) } });

  it("refuseBlocked answers 403 with the message the pages show", async () => {
    state.rules = [{ network: "198.51.100.0/24", kind: "block" }];
    const res = await refuseBlocked(from("198.51.100.40", "/api/auth/login"));
    expect(res?.status).toBe(403);
    expect((await res!.json()).error).toMatch(/blocked/);
    expect(await refuseBlocked(from("203.0.113.40", "/api/auth/login"))).toBeNull();
  });

  it("sign-in, registration and reset refuse a blocked address before asking FastAPI", async () => {
    state.rules = [{ network: "198.51.100.0/24", kind: "block" }];
    const { NextRequest } = await import("next/server");
    const post = (path: string, body: unknown) =>
      new NextRequest(`http://localhost${path}`, { method: "POST", body: JSON.stringify(body), headers: { "x-real-ip": "198.51.100.41", "content-type": "application/json" } });
    const routes = await Promise.all([
      import("@/app/api/auth/login/route"),
      import("@/app/api/auth/app/login/route"),
      import("@/app/api/auth/register/route"),
      import("@/app/api/auth/forgot-password/route"),
      import("@/app/api/auth/reset-password/route"),
    ]);
    const [login, appLogin, register, forgot, reset] = routes;
    const before = callBackend.mock.calls.length;
    expect((await login.POST(post("/api/auth/login", { email: "a@test.invalid", password: "x" }))).status).toBe(403);
    const app = await appLogin.POST(post("/api/auth/app/login", { email: "a@test.invalid", password: "x" }));
    expect([app.status, (await app.json()).error.code]).toEqual([403, "address_blocked"]);
    expect((await register.POST(post("/api/auth/register", { invite: "i", password: "x" }))).status).toBe(403);
    expect((await register.GET(new NextRequest("http://localhost/api/auth/register?invite=i", { headers: { "x-real-ip": "198.51.100.41" } }))).status).toBe(403);
    expect((await forgot.POST(post("/api/auth/forgot-password", { email: "a@test.invalid" }))).status).toBe(403);
    expect((await reset.POST(post("/api/auth/reset-password", { token: "t", password: "x" }))).status).toBe(403);
    // Only the rules were read: no sign-in, registration or reset reached FastAPI.
    expect(callBackend.mock.calls.slice(before).every(([path]) => path === "/api/v1/address-controls")).toBe(true);
  }, 60_000); // the first import of five routes is slow

  it("Google sign-in sends a blocked address back to the login page", async () => {
    state.rules = [{ network: "198.51.100.0/24", kind: "block" }];
    const { NextRequest } = await import("next/server");
    const google = await import("@/app/api/auth/google/route");
    const res = await google.GET(new NextRequest("http://localhost/api/auth/google", { headers: { "x-real-ip": "198.51.100.42" } }));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/auth/login?error=address_blocked");
  });
});
