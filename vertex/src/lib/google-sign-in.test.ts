// Google sign-in's half on this side (users step 8.2): the OAuth state
// binds the callback to the browser that started it (login CSRF), and
// FastAPI's answer becomes cookies or a way back to the login page. Who may
// sign in, and linking (#131's rules), are FastAPI's: vertex_be/tests/
// test_sessions.py.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.GOOGLE_CLIENT_ID = "test-client";
});

const callBackend = vi.fn();
vi.mock("@/lib/backend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/backend")>()),
  callBackend: (...args: unknown[]) => callBackend(...args),
}));
const alerts = vi.fn();
vi.mock("@/lib/security-monitor", () => ({ onSecurityEvent: (...args: unknown[]) => alerts(...args) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7" }) }));

import { NextRequest, type NextResponse } from "next/server";
import { GOOGLE_STATE_COOKIE } from "@/lib/google-oauth";
import { GET as start } from "@/app/api/auth/google/route";
import { GET as callback } from "@/app/api/auth/google/callback/route";

const session = { family_id: "f1", access_token: "at", refresh_token: "rt", refresh_expires_at: "2026-11-13T00:00:00.000Z" };
const signedIn = { ok: true, status: 200, body: { data: { user: { id: "u1", full_name: "G", email: "g@test.invalid", role: "candidate" }, session } } };

/** Starts a sign-in as the browser would, returning its cookie and Google's state. */
async function begin(redirect = "/dashboard/profile") {
  const res = (await start(new NextRequest(`http://localhost/api/auth/google?redirect=${encodeURIComponent(redirect)}`))) as NextResponse;
  const state = new URL(res.headers.get("location")!).searchParams.get("state")!;
  return { cookie: res.cookies.get(GOOGLE_STATE_COOKIE)!, state };
}

async function returnFromGoogle(state: string | null, cookie: string | null): Promise<NextResponse> {
  const url = new URL("http://localhost/api/auth/google/callback?code=abc");
  if (state !== null) url.searchParams.set("state", state);
  return (await callback(new NextRequest(url, { headers: cookie ? { cookie: `${GOOGLE_STATE_COOKIE}=${cookie}` } : {} }))) as NextResponse;
}

async function signInWithGoogle() {
  const { cookie, state } = await begin();
  return returnFromGoogle(state, cookie.value);
}

beforeEach(() => {
  callBackend.mockReset();
  alerts.mockReset();
});

describe("the OAuth state (login CSRF)", () => {
  it("is a nonce held in a short-lived Lax HttpOnly cookie", async () => {
    const { cookie, state } = await begin();
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "lax", maxAge: 600, path: "/api/auth/google" });
    expect(state.startsWith(`${cookie.value}.`)).toBe(true);
  });

  it("a callback without the matching cookie never reaches FastAPI or Google", async () => {
    const { state } = await begin();
    for (const [s, c] of [[state, null], [state, "another-nonce"], [null, "x"], ["forged.L2Rhc2hib2FyZA", "forged-but-not-this"]] as const) {
      const res = await returnFromGoogle(s, c);
      expect(res.headers.get("location")).toContain("error=google_state_invalid");
    }
    expect(callBackend).not.toHaveBeenCalled();
  });
});

describe("FastAPI's answer", () => {
  it("passes the code on, then sets the session cookies, returns to the page asked for and drops the nonce", async () => {
    callBackend.mockResolvedValueOnce(signedIn);
    const res = await signInWithGoogle();
    const [path, call] = callBackend.mock.calls[0];
    expect([path, call.body.code, call.body.redirect_uri.endsWith("/api/auth/google/callback"), call.asUser]).toEqual(["/api/v1/auth/google", "abc", true, false]);
    expect(call.forward["X-Forwarded-For"]).toBe("203.0.113.7");
    expect(new URL(res.headers.get("location")!).pathname).toBe("/dashboard/profile");
    expect(res.cookies.get("auth_token")?.value).toBe("at");
    expect(res.cookies.get("refresh_token")).toMatchObject({ value: "rt", httpOnly: true, sameSite: "strict", path: "/api/auth" });
    expect(res.cookies.get(GOOGLE_STATE_COOKIE)).toMatchObject({ value: "", maxAge: 0 });
  });

  it.each(["google_email_unverified", "google_no_account", "google_token_failed", "google_unavailable"])("a refusal (%s) goes back to the login page, without cookies", async (code) => {
    callBackend.mockResolvedValueOnce({ ok: false, status: 401, error: { code, message: "Refused.", details: { email_fp: "fp1" } } });
    const res = await signInWithGoogle();
    expect(res.headers.get("location")).toContain(`error=${code}`);
    expect(res.cookies.get("auth_token")).toBeUndefined();
  });

  it("a refused sign-in feeds the brute-force alerts", async () => {
    callBackend.mockResolvedValueOnce({ ok: false, status: 401, error: { code: "google_no_account", message: "Refused.", details: { email_fp: "fp1" } } });
    await signInWithGoogle();
    expect(alerts).toHaveBeenCalledWith("login_failed", null, "login", { email_fp: "fp1", ip: "203.0.113.7" });
  });

  it("an unexpected answer is a generic failure, never an open redirect", async () => {
    callBackend.mockResolvedValueOnce({ ok: false, status: 502, error: { code: "backend_unavailable", message: "Down." } });
    expect((await signInWithGoogle()).headers.get("location")).toMatch(/\/auth\/login\?error=google_failed$/);
  });
});
