import { NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCESS_COOKIE, REFRESH_COOKIE, REFRESH_COOKIE_PATH, SIGNED_IN_COOKIE, clearSessionCookies, setSessionCookies } from "./session";

// The session cookies (lib/session.ts): out of reach of page script and of
// other sites, and only sent over HTTPS in production.

const session = { familyId: "family-1", accessToken: "access.jwt.value", refreshToken: "refresh-opaque-value", refreshExpiresAt: new Date(Date.now() + 14 * 86_400_000) };

function cookieHeaders(res: NextResponse): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of res.headers.getSetCookie()) out[line.split("=")[0]] = line.toLowerCase();
  return out;
}

afterEach(() => vi.unstubAllEnvs());

describe("SEC-AUTH-012 SEC-WEB-003 the session cookies are locked down", () => {
  it("the access and refresh cookies: HttpOnly, SameSite=Strict, Secure in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = NextResponse.json({});
    setSessionCookies(res, session);
    const c = cookieHeaders(res);
    for (const name of [ACCESS_COOKIE, REFRESH_COOKIE]) {
      expect(c[name]).toContain("httponly");
      expect(c[name]).toContain("samesite=strict");
      expect(c[name]).toContain("secure");
    }
    // The refresh token only goes to the refresh route.
    expect(c[REFRESH_COOKIE]).toContain(`path=${REFRESH_COOKIE_PATH.toLowerCase()}`);
  });

  it("the signed-in marker page script may read holds no credential", () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = NextResponse.json({});
    setSessionCookies(res, session);
    const marker = res.headers.getSetCookie().find((line) => line.startsWith(`${SIGNED_IN_COOKIE}=`))!;
    expect(marker.startsWith(`${SIGNED_IN_COOKIE}=1;`)).toBe(true);
    expect(marker.toLowerCase()).toContain("samesite=strict");
    expect(marker).not.toContain(session.accessToken);
  });

  it("signing out clears every one of them", () => {
    const res = NextResponse.json({});
    clearSessionCookies(res);
    const c = cookieHeaders(res);
    for (const name of [ACCESS_COOKIE, REFRESH_COOKIE, SIGNED_IN_COOKIE]) expect(c[name]).toContain("max-age=0");
  });
});
