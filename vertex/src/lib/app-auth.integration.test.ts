// The mobile app's sign-in (lib/app-auth.ts, backend plan step 0.6): the
// same accounts and sessions as the browser, with the tokens in the body and
// never in cookies. Against the real test database.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";

const state = vi.hoisted(() => {
  process.env.JWT_SECRET ??= "test-only-signing-value-not-a-real-secret-app";
  return { token: "" };
});
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: (name: string) => (name === "auth_token" && state.token ? { value: state.token } : undefined) }),
}));

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { getAuthUser } from "@/lib/api-auth";
import { verifyToken } from "@/lib/jwt";
import { POST as appLogin, OPTIONS as appLoginPreflight } from "@/app/api/auth/app/login/route";
import { POST as appRefresh } from "@/app/api/auth/app/refresh/route";
import { POST as appLogout } from "@/app/api/auth/app/logout/route";
import { POST as webLogin } from "@/app/api/auth/login/route";

const PASSWORD = "TestPassword123!";
const tag = `app-auth-${Date.now()}`;
let seq = 0;
const created: string[] = [];
let passwordHash = "";

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

async function makeUser(opts: { verified?: boolean } = {}) {
  const user = await prisma.user.create({
    data: { full_name: "App Test", email: `${tag}-${seq++}@test.invalid`, role: "director", password_hash: passwordHash, email_verified: opts.verified ?? true },
  });
  created.push(user.id);
  return user;
}

// A fresh client address per request, so the shared login rate limit
// (10 a minute per address) never trips across tests.
function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `10.9.${seq}.${seq++ % 250}`, ...headers },
    body: JSON.stringify(body),
  });
}

interface AppSession {
  user: { id: string; email: string; role: string; full_name?: string };
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

async function signIn(email: string): Promise<AppSession> {
  const res = await appLogin(post("/api/auth/app/login", { email, password: PASSWORD }));
  expect(res.status).toBe(200);
  return (await res.json()).data;
}

beforeEach(() => {
  vi.stubEnv("APP_ORIGINS", "http://localhost:3500, http://localhost:3501");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  state.token = "";
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: created } } });
});

describe("app sign-in", () => {
  it("returns the session in the body and sets no cookie", async () => {
    const user = await makeUser();
    const res = await appLogin(post("/api/auth/app/login", { email: user.email, password: PASSWORD }));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");

    const { data } = await res.json();
    expect(data.user).toEqual({ id: user.id, email: user.email, role: "director", full_name: "App Test" });
    const claims = verifyToken(data.accessToken);
    expect(claims.userId).toBe(user.id);
    expect(new Date(data.accessTokenExpiresAt).getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    expect(data.refreshToken).toMatch(/\S{20,}/);

    // The same server-side session as a browser sign-in: it is live.
    state.token = data.accessToken;
    expect((await getAuthUser())?.userId).toBe(user.id);
  });

  it("refuses a wrong password and an unverified account, without tokens", async () => {
    const user = await makeUser();
    const wrong = await appLogin(post("/api/auth/app/login", { email: user.email, password: "nope-nope-nope" }));
    expect(wrong.status).toBe(401);
    expect(JSON.stringify(await wrong.json())).not.toContain("Token");

    const unverified = await makeUser({ verified: false });
    const res = await appLogin(post("/api/auth/app/login", { email: unverified.email, password: PASSWORD }));
    expect(res.status).toBe(403);
  });

  it("gives an unknown account the same answer as a wrong password", async () => {
    const res = await appLogin(post("/api/auth/app/login", { email: `${tag}-nobody@test.invalid`, password: PASSWORD }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Invalid email or password." });
  });
});

describe("app refresh", () => {
  it("rotates: a new pair for the refresh token, which is then spent", async () => {
    const first = await signIn((await makeUser()).email);
    const res = await appRefresh(post("/api/auth/app/refresh", { refreshToken: first.refreshToken }));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.refreshToken).not.toBe(first.refreshToken);
    expect(verifyToken(data.accessToken).sid).toBe(verifyToken(first.accessToken).sid);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("presenting a spent refresh token again ends the session (reuse detection)", async () => {
    const first = await signIn((await makeUser()).email);
    const second = (await (await appRefresh(post("/api/auth/app/refresh", { refreshToken: first.refreshToken }))).json()).data;
    // Past the race window for a concurrent refresh.
    vi.useFakeTimers({ now: Date.now() + 60_000, toFake: ["Date"] });
    try {
      const replay = await appRefresh(post("/api/auth/app/refresh", { refreshToken: first.refreshToken }));
      expect(replay.status).toBe(401);
    } finally {
      vi.useRealTimers();
    }
    const after = await appRefresh(post("/api/auth/app/refresh", { refreshToken: second.refreshToken }));
    expect(after.status).toBe(401);
  });

  it("never takes the refresh token from the cookie", async () => {
    const first = await signIn((await makeUser()).email);
    const res = await appRefresh(post("/api/auth/app/refresh", {}, { cookie: `refresh_token=${first.refreshToken}` }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "session_ended", message: "Please sign in again." } });
  });

  it("refuses an unknown or malformed refresh token", async () => {
    expect((await appRefresh(post("/api/auth/app/refresh", { refreshToken: "not-a-token" }))).status).toBe(401);
    expect((await appRefresh(post("/api/auth/app/refresh", { refreshToken: 42 }))).status).toBe(401);
  });
});

describe("app sign-out", () => {
  it("ends the session server-side, so the access token stops working", async () => {
    const session = await signIn((await makeUser()).email);
    state.token = session.accessToken;
    expect(await getAuthUser()).not.toBeNull();

    const res = await appLogout(post("/api/auth/app/logout", { refreshToken: session.refreshToken }));
    expect(res.status).toBe(200);
    expect(await getAuthUser()).toBeNull();
    expect((await appRefresh(post("/api/auth/app/refresh", { refreshToken: session.refreshToken }))).status).toBe(401);
  });

  it("answers the same for a token it doesn't know", async () => {
    const res = await appLogout(post("/api/auth/app/logout", { refreshToken: "unknown" }));
    expect((await res.json())).toEqual({ data: { signedOut: true } });
  });
});

describe("CORS (the Flutter web build)", () => {
  it("allows a configured origin, without credentials", async () => {
    const user = await makeUser();
    const res = await appLogin(post("/api/auth/app/login", { email: user.email, password: PASSWORD }, { origin: "http://localhost:3501" }));
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:3501");
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("gives any other origin nothing", async () => {
    const res = await appLogin(post("/api/auth/app/login", { email: "x@test.invalid", password: PASSWORD }, { origin: "https://evil.example" }));
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("answers a preflight for a configured origin only", async () => {
    const ok = appLoginPreflight(new NextRequest("http://localhost/api/auth/app/login", { method: "OPTIONS", headers: { origin: "http://localhost:3500" } }));
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
    const other = appLoginPreflight(new NextRequest("http://localhost/api/auth/app/login", { method: "OPTIONS", headers: { origin: "https://evil.example" } }));
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("the browser's sign-in is unchanged", () => {
  it("still sets the cookies and keeps its body", async () => {
    const user = await makeUser();
    const res = await webLogin(post("/api/auth/login", { email: user.email, password: PASSWORD }));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("auth_token=");
    const body = await res.json();
    expect(body).toEqual({ message: "Login successful", user: { id: user.id, full_name: "App Test", email: user.email, role: "director" } });
    expect(JSON.stringify(body)).not.toContain("refreshToken");
  });
});
