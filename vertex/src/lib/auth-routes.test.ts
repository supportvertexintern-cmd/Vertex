// The /api/auth routes since users step 8.2: FastAPI checks passwords and
// issues, rotates and revokes sessions (vertex_be/tests/test_sessions.py);
// these routes keep the rate limits, the cookies (browser) or the token body
// (mobile app, never cookies), CORS for the Flutter web build, the response
// shapes, and the alerts raised from FastAPI's refusals.
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  process.env.JWT_SECRET ??= "test-only-signing-value-not-a-real-secret-auth";
  return { user: null as null | { userId: string; email: string; role: string; sid: string; ver: number } };
});

const callBackend = vi.fn();
vi.mock("@/lib/backend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/backend")>()),
  callBackend: (...args: unknown[]) => callBackend(...args),
}));
const alerts = vi.fn();
vi.mock("@/lib/security-monitor", () => ({ onSecurityEvent: (...args: unknown[]) => alerts(...args) }));
vi.mock("@/lib/audit", () => ({ recordSecurityEvent: async () => undefined }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-real-ip": "203.0.113.7" }) }));
vi.mock("@/lib/api-auth", () => ({
  getAuthUser: async () => state.user,
  requireAuth: (user: unknown) => (user ? null : Response.json({ error: "denied" }, { status: 401 })),
  requireAdmin: (user: { role: string } | null) => (!user ? Response.json({}, { status: 401 }) : user.role === "admin" ? null : Response.json({}, { status: 403 })),
}));

import { NextRequest, type NextResponse } from "next/server";
import { POST as webLogin } from "@/app/api/auth/login/route";
import { POST as appLogin, OPTIONS as appLoginPreflight } from "@/app/api/auth/app/login/route";
import { GET as refreshPage, POST as webRefresh } from "@/app/api/auth/refresh/route";
import { POST as appRefresh } from "@/app/api/auth/app/refresh/route";
import { POST as webLogout } from "@/app/api/auth/logout/route";
import { POST as appLogout } from "@/app/api/auth/app/logout/route";
import { DELETE as signOutEverywhere, GET as mySessions } from "@/app/api/auth/sessions/route";
import { DELETE as endOne } from "@/app/api/auth/sessions/[id]/route";
import { DELETE as adminRevoke, GET as adminList } from "@/app/api/admin/users/[id]/sessions/route";
// As behind the stack's edge proxy (lib/client-ip.ts).
process.env.TRUST_PROXY_HEADERS = "true";


const session = { family_id: "f1", access_token: "access-1", refresh_token: "refresh-1", refresh_expires_at: "2026-11-13T00:00:00.000Z" };
const user = { id: "u1", full_name: "Abebe", email: "a@test.invalid", role: "director" };
const signedIn = { ok: true, status: 200, body: { data: { user, session } } };
const refused = (status: number, code: string, message: string, details?: unknown) => ({ ok: false, status, error: { code, message, details } });

let seq = 0;
// A fresh client address per request, so the per-address limits never trip across tests.
function post(url: string, body?: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": `10.9.${seq}.${seq++ % 250}`, "user-agent": "Browser/1", ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}
const as = (res: Response) => res as NextResponse;

beforeEach(() => {
  callBackend.mockReset();
  alerts.mockReset();
  state.user = null;
  vi.stubEnv("APP_ORIGINS", "http://localhost:3500");
});

describe("browser sign-in", () => {
  it("passes the credentials on with the client's address and device, then sets the cookies and keeps its body", async () => {
    callBackend.mockResolvedValueOnce(signedIn);
    const res = as(await webLogin(post("/api/auth/login", { email: "a@test.invalid", password: "pw" })));
    const [path, call] = callBackend.mock.calls[0];
    expect([path, call.body, call.asUser]).toEqual(["/api/v1/auth/login", { email: "a@test.invalid", password: "pw", client: "web" }, false]);
    expect(call.forward).toEqual({ "X-Forwarded-For": "203.0.113.7", "User-Agent": "Browser/1" });
    expect(await res.json()).toEqual({ message: "Login successful", user });
    expect(res.cookies.get("auth_token")).toMatchObject({ value: "access-1", httpOnly: true, sameSite: "strict", path: "/", maxAge: 900 });
    expect(res.cookies.get("refresh_token")).toMatchObject({ value: "refresh-1", httpOnly: true, sameSite: "strict", path: "/api/auth" });
  });

  it("keeps the older string errors, with details only for validation", async () => {
    callBackend.mockResolvedValueOnce(refused(401, "invalid_credentials", "Invalid email or password.", { email_fp: "fp1" }));
    const wrong = as(await webLogin(post("/api/auth/login", { email: "a@test.invalid", password: "x" })));
    expect([wrong.status, await wrong.json(), wrong.cookies.get("auth_token")]).toEqual([401, { error: "Invalid email or password." }, undefined]);
    callBackend.mockResolvedValueOnce(refused(422, "validation_error", "Validation failed", { email: ["Invalid email address"] }));
    const invalid = await webLogin(post("/api/auth/login", { email: "nope" }));
    expect(await invalid.json()).toEqual({ error: "Validation failed", details: { email: ["Invalid email address"] } });
    const bad = await webLogin(post("/api/auth/login", "{not json"));
    expect([bad.status, await bad.json()]).toEqual([400, { error: "Invalid JSON" }]);
  });

  it("a refused sign-in feeds the brute-force alerts", async () => {
    callBackend.mockResolvedValueOnce(refused(401, "invalid_credentials", "Invalid email or password.", { email_fp: "fp1" }));
    await webLogin(post("/api/auth/login", { email: "a@test.invalid", password: "x" }));
    expect(alerts).toHaveBeenCalledWith("login_failed", null, "login", { email_fp: "fp1", ip: "203.0.113.7" });
  });

  it("the per-address limit answers before FastAPI is asked", async () => {
    vi.stubEnv("LOGIN_RATE_LIMIT_MAX", "2");
    callBackend.mockResolvedValue(signedIn);
    const from = { "x-real-ip": "198.51.100.77" };
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await webLogin(post("/api/auth/login", { email: "a@test.invalid", password: "pw" }, from))).status);
    expect(codes).toEqual([200, 200, 429]);
    expect(callBackend).toHaveBeenCalledTimes(2);
  });
});

describe("app sign-in (lib/app-auth.ts)", () => {
  it("returns the session in the body and sets no cookie", async () => {
    callBackend.mockResolvedValueOnce(signedIn);
    const res = as(await appLogin(post("/api/auth/app/login", { email: "a@test.invalid", password: "pw" })));
    expect(callBackend.mock.calls[0][1].body.client).toBe("app");
    const { data } = await res.json();
    expect(data).toMatchObject({ user, accessToken: "access-1", refreshToken: "refresh-1", refreshTokenExpiresAt: "2026-11-13T00:00:00.000Z" });
    expect(Date.parse(data.accessTokenExpiresAt) - Date.now()).toBeGreaterThan(14 * 60_000);
    expect(res.cookies.getAll()).toEqual([]);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("refuses with the same messages, without tokens", async () => {
    callBackend.mockResolvedValueOnce(refused(403, "email_unverified", "Please verify your email before logging in."));
    const res = await appLogin(post("/api/auth/app/login", { email: "a@test.invalid", password: "pw" }));
    expect([res.status, await res.json()]).toEqual([403, { error: "Please verify your email before logging in." }]);
    callBackend.mockResolvedValueOnce(refused(429, "rate_limited", "Too many login attempts. Please try again later."));
    const locked = await appLogin(post("/api/auth/app/login", { email: "a@test.invalid", password: "pw" }));
    expect(await locked.json()).toEqual({ error: { code: "rate_limited", message: "Too many login attempts. Please try again later." } });
  });

  it("CORS: a configured origin only, without credentials", async () => {
    callBackend.mockResolvedValue(signedIn);
    const allowed = await appLogin(post("/api/auth/app/login", { email: "a@test.invalid", password: "pw" }, { origin: "http://localhost:3500" }));
    expect(allowed.headers.get("access-control-allow-origin")).toBe("http://localhost:3500");
    expect(allowed.headers.get("access-control-allow-credentials")).toBeNull();
    const other = await appLogin(post("/api/auth/app/login", { email: "a@test.invalid", password: "pw" }, { origin: "https://evil.test" }));
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
    expect((await appLoginPreflight(new NextRequest("http://localhost/api/auth/app/login", { method: "OPTIONS", headers: { origin: "http://localhost:3500" } }))).status).toBe(204);
  });
});

describe("refresh", () => {
  const cookie = { cookie: "refresh_token=refresh-0" };

  it("the browser's: the cookie's token is passed on and the new pair set", async () => {
    callBackend.mockResolvedValueOnce(signedIn);
    const res = as(await webRefresh(post("/api/auth/refresh", undefined, cookie)));
    expect(callBackend.mock.calls[0][1].body).toEqual({ refresh_token: "refresh-0" });
    expect(await res.json()).toEqual({ data: { role: "director" } });
    expect(res.cookies.get("refresh_token")?.value).toBe("refresh-1");
  });

  it("a refusal clears the cookies, except for a lost race", async () => {
    callBackend.mockResolvedValueOnce(refused(401, "session_ended", "Please sign in again.", { reason: "expired" }));
    const ended = as(await webRefresh(post("/api/auth/refresh", undefined, cookie)));
    expect([ended.status, await ended.json()]).toEqual([401, { error: { code: "session_ended", message: "Please sign in again." } }]);
    expect(ended.cookies.get("auth_token")).toMatchObject({ value: "", maxAge: 0 });
    callBackend.mockResolvedValueOnce(refused(401, "session_ended", "Please sign in again.", { reason: "superseded" }));
    const race = as(await webRefresh(post("/api/auth/refresh", undefined, cookie)));
    expect([race.status, race.cookies.getAll()]).toEqual([401, []]);
  });

  it("FastAPI being down signs nobody out", async () => {
    callBackend.mockResolvedValueOnce(refused(503, "backend_unavailable", "The service is unavailable. Please try again."));
    const res = as(await webRefresh(post("/api/auth/refresh", undefined, cookie)));
    expect([res.status, res.cookies.getAll()]).toEqual([503, []]);
  });

  it("a reused token raises the alert", async () => {
    callBackend.mockResolvedValueOnce(refused(401, "session_ended", "Please sign in again.", { reason: "reused", session: "f9", user_id: "u9", used_at: "2026-10-30T10:00:00.000Z" }));
    await webRefresh(post("/api/auth/refresh", undefined, cookie));
    expect(alerts).toHaveBeenCalledWith("refresh_token_reused", "u9", "f9", { used_at: "2026-10-30T10:00:00.000Z" });
  });

  it("a page navigation renews and goes back, or goes to sign-in", async () => {
    callBackend.mockResolvedValueOnce(signedIn);
    const back = as(await refreshPage(new NextRequest("http://localhost/api/auth/refresh?redirect=/admin/users", { headers: cookie })));
    expect([back.status, new URL(back.headers.get("location")!).pathname, back.cookies.get("auth_token")?.value]).toEqual([303, "/admin/users", "access-1"]);
    callBackend.mockResolvedValueOnce(refused(401, "session_ended", "Please sign in again.", { reason: "revoked" }));
    const out = await refreshPage(new NextRequest("http://localhost/api/auth/refresh?redirect=/admin/users", { headers: cookie }));
    expect(out.headers.get("location")).toContain("/auth/login?redirect=%2Fadmin%2Fusers");
  });

  it("no refresh token at all is answered here, never rate-limited: signed-out pages ask often", async () => {
    const from = { "x-real-ip": "198.51.100.88" };
    const codes = new Set<number>();
    for (let i = 0; i < 70; i++) codes.add((await webRefresh(post("/api/auth/refresh", undefined, from))).status);
    const page = await refreshPage(new NextRequest("http://localhost/api/auth/refresh?redirect=/partner", { headers: from }));
    expect([...codes, page.status, page.headers.get("location")?.includes("/auth/login?redirect=%2Fpartner")]).toEqual([401, 303, true]);
    expect(callBackend).not.toHaveBeenCalled();
  });

  it("the app's: the token from the body only, never the cookie", async () => {
    callBackend.mockResolvedValue(signedIn);
    const cookieOnly = await appRefresh(post("/api/auth/app/refresh", {}, cookie));
    expect([cookieOnly.status, callBackend.mock.calls.length]).toEqual([401, 0]);
    const res = as(await appRefresh(post("/api/auth/app/refresh", { refreshToken: "refresh-0" })));
    expect(callBackend.mock.calls[0][1].body).toEqual({ refresh_token: "refresh-0" });
    expect([(await res.json()).data.refreshToken, res.cookies.getAll()]).toEqual(["refresh-1", []]);
  });
});

describe("sign-out", () => {
  it("the browser's: FastAPI ends the session, the cookies go either way", async () => {
    callBackend.mockResolvedValueOnce({ ok: true, status: 200, body: { data: { signed_out: true } } });
    const res = as(await webLogout(post("/api/auth/logout", undefined, { cookie: "refresh_token=refresh-0" })));
    expect(callBackend.mock.calls[0][1]).toMatchObject({ body: { refresh_token: "refresh-0", client: "web" }, asUser: false });
    expect(await res.json()).toEqual({ message: "Logged out successfully." });
    expect(res.cookies.get("refresh_token")).toMatchObject({ value: "", maxAge: 0 });
    // Signed in: the live access token goes along, for when there's no refresh cookie.
    state.user = { userId: "u1", email: "a@test.invalid", role: "director", sid: "f1", ver: 0 };
    callBackend.mockResolvedValueOnce(refused(503, "backend_unavailable", "Down."));
    expect((await webLogout(post("/api/auth/logout"))).status).toBe(200);
    expect(callBackend.mock.calls[1][1].asUser).toBe(true);
  });

  it("the app's always answers the same", async () => {
    callBackend.mockResolvedValueOnce({ ok: true, status: 200, body: { data: { signed_out: true } } });
    const res = await appLogout(post("/api/auth/app/logout", { refreshToken: "refresh-0" }));
    expect(callBackend.mock.calls[0][1].body).toEqual({ refresh_token: "refresh-0", client: "app" });
    expect(await res.json()).toEqual({ data: { signedOut: true } });
  });
});

describe("the session lists", () => {
  beforeEach(() => {
    state.user = { userId: "u1", email: "a@test.invalid", role: "director", sid: "f1", ver: 0 };
  });

  it("need a session", async () => {
    state.user = null;
    expect((await mySessions(new NextRequest("http://localhost/api/auth/sessions"))).status).toBe(401);
    expect(callBackend).not.toHaveBeenCalled();
  });

  it("list and end everywhere through FastAPI; ending everywhere clears this browser's cookies", async () => {
    callBackend.mockResolvedValueOnce({ ok: true, status: 200, body: { data: [{ id: "f1", current: true }] } });
    expect(await (await mySessions(new NextRequest("http://localhost/api/auth/sessions"))).json()).toEqual({ data: [{ id: "f1", current: true }] });
    callBackend.mockResolvedValueOnce({ ok: true, status: 200, body: { data: { ended: 2 } } });
    const res = as(await signOutEverywhere(new NextRequest("http://localhost/api/auth/sessions", { method: "DELETE" })));
    expect([callBackend.mock.calls[1][0], await res.json()]).toEqual(["/api/v1/auth/sessions", { data: { ended: 2 } }]);
    expect(res.cookies.get("auth_token")).toMatchObject({ value: "", maxAge: 0 });
  });

  it("ending one clears the cookies only when it's this browser's", async () => {
    const del = (id: string) => endOne(new NextRequest(`http://localhost/api/auth/sessions/${id}`, { method: "DELETE" }), { params: Promise.resolve({ id }) });
    callBackend.mockResolvedValueOnce({ ok: true, status: 200, body: { data: { id: "f2" } } });
    expect(as(await del("f2")).cookies.getAll()).toEqual([]);
    callBackend.mockResolvedValueOnce({ ok: true, status: 200, body: { data: { id: "f1" } } });
    expect(as(await del("f1")).cookies.get("auth_token")).toMatchObject({ maxAge: 0 });
    callBackend.mockResolvedValueOnce(refused(404, "not_found", "Session not found."));
    const missing = await del("other");
    expect([missing.status, await missing.json()]).toEqual([404, { error: { code: "not_found", message: "Session not found." } }]);
  });

  it("an admin's view of another user's, admins only", async () => {
    const ctx = { params: Promise.resolve({ id: "u2" }) };
    expect((await adminList(new NextRequest("http://localhost/x"), ctx)).status).toBe(403);
    state.user = { userId: "a1", email: "admin@test.invalid", role: "admin", sid: "f3", ver: 0 };
    callBackend.mockResolvedValueOnce({ ok: true, status: 200, body: { data: { ended: 1 } } });
    const res = await adminRevoke(new NextRequest("http://localhost/x", { method: "DELETE" }), ctx);
    expect([callBackend.mock.calls[0][0], callBackend.mock.calls[0][1].method, await res.json()]).toEqual(["/api/v1/users/u2/sessions", "DELETE", { data: { ended: 1 } }]);
  });
});
