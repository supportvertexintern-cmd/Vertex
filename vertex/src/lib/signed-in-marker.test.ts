// The signed-in marker (auth hardening plan A.4): a portal visit goes through
// /api/auth/refresh only when the browser has a session to renew; a
// signed-out visit goes straight to sign-in. The marker is set and cleared
// with the session cookies, holds nothing secret and signs nobody in.
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.JWT_SECRET ??= "test-only-signing-value-not-a-real-secret-marker";
});

import { NextRequest, NextResponse } from "next/server";
import { proxy } from "@/proxy";
import { signToken } from "@/lib/jwt";
import { clearSessionCookies, setSessionCookies, SIGNED_IN_COOKIE } from "@/lib/session";

const visit = (path: string, cookies: Record<string, string> = {}) =>
  proxy(new NextRequest(`http://localhost${path}`, { headers: { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ") } }));
const where = (res: Response) => res.headers.get("location")?.replace("http://localhost", "");
const token = (role = "admin") => signToken({ userId: "u1", email: "u@test.invalid", role: role as never, sid: "f1", ver: 0 });

describe("portal visits", () => {
  it("signed out (no marker): straight to sign-in, no refresh call", () => {
    expect(where(visit("/dashboard?tab=1"))).toBe("/auth/login?redirect=%2Fdashboard%3Ftab%3D1");
    expect(where(visit("/admin/users", { auth_token: "garbage" }))).toBe("/auth/login?redirect=%2Fadmin%2Fusers");
  });

  it("marked, access token gone or expired: through refresh, as before", () => {
    expect(where(visit("/dashboard", { [SIGNED_IN_COOKIE]: "1" }))).toBe("/api/auth/refresh?redirect=%2Fdashboard");
    expect(where(visit("/admin", { [SIGNED_IN_COOKIE]: "1", auth_token: "expired-or-bad" }))).toBe("/api/auth/refresh?redirect=%2Fadmin");
  });

  it("the marker alone signs nobody in", () => {
    const res = visit("/admin", { [SIGNED_IN_COOKIE]: "1" });
    expect(res.status).toBe(307);
    expect(where(res)).not.toBe("/admin");
  });

  it("a session from before the marker gets one, for this browser session", () => {
    const res = visit("/admin", { auth_token: token() }) as NextResponse;
    expect(res.headers.get("location")).toBeNull(); // let through
    const marker = res.cookies.get(SIGNED_IN_COOKIE);
    expect([marker?.value, marker?.maxAge, marker?.httpOnly ?? false]).toEqual(["1", undefined, false]);
    const again = visit("/admin", { auth_token: token(), [SIGNED_IN_COOKIE]: "1" }) as NextResponse;
    expect(again.cookies.get(SIGNED_IN_COOKIE)).toBeUndefined();
  });
});

describe("the cookie itself", () => {
  it("is set with the session, as long as the refresh cookie, readable by the page, holding only 1", () => {
    const res = NextResponse.json({});
    setSessionCookies(res, { accessToken: "a", refreshToken: "r", refreshExpiresAt: new Date(Date.now() + 3600_000), familyId: "f" } as never);
    const marker = res.cookies.get(SIGNED_IN_COOKIE)!;
    const refresh = res.cookies.get("refresh_token")!;
    expect([marker.value, marker.httpOnly, marker.sameSite, marker.path, marker.maxAge]).toEqual(["1", false, "strict", "/", refresh.maxAge]);
  });

  it("is cleared with the session", () => {
    const res = NextResponse.json({});
    clearSessionCookies(res);
    expect(res.cookies.get(SIGNED_IN_COOKIE)).toMatchObject({ value: "", maxAge: 0 });
  });
});
