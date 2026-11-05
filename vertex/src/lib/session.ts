import type { NextResponse } from "next/server";

// Sessions (gap G19, exception E6; docs/security/session-management.md).
//
// A session is a refresh-token *family*: the RefreshToken rows sharing one
// family_id. The browser holds two HttpOnly cookies:
//
//   auth_token     15-minute access JWT, sent everywhere. Carries the user,
//                  the family (sid) and the user's token_version (ver).
//   refresh_token  opaque random value, sent only to /api/auth/*. Stored as
//                  a SHA-256 hash. Each use rotates it.
//
// FastAPI issues, rotates and revokes them since users and sessions step
// 8.2 (vertex_be/app/services/sessions.py; docs/architecture/
// users-handover.md): the /api/auth routes pass each request on
// (lib/auth-backend.ts) and set or clear the cookies from its answer.
//
// FastAPI checks every request against the database (current_user in
// vertex_be/app/core/auth.py): the user must still exist, token_version
// must match, and the family must still have a live token. So revoking a
// family, deleting a user or changing a password or role (a database
// trigger bumps token_version) stops access on the very next request, not
// when the token expires. This app reads no data of its own since reads
// handover R7d (D2 A), so it checks the token's signature and expiry only
// (getAuthUser in api-auth.ts): that decides which page or early refusal
// to show, never what data comes back.

import { ACCESS_COOKIE, REFRESH_COOKIE, REFRESH_COOKIE_PATH, SIGNED_IN_COOKIE } from "./session-constants";
export { ACCESS_COOKIE, REFRESH_COOKIE, REFRESH_COOKIE_PATH, SIGNED_IN_COOKIE };

// The access token's lifetime, for the cookie and the app's body. The
// session lifetimes, rotation and its race window are FastAPI's.
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

export interface IssuedSession {
  familyId: string;
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

// --- cookies ---------------------------------------------------------------

function secure(): boolean {
  return process.env.NODE_ENV === "production";
}

export function setSessionCookies(res: NextResponse, session: IssuedSession): void {
  // One clock read, so the marker can never outlive or undercut the refresh cookie.
  const refreshMaxAge = Math.max(0, Math.floor((session.refreshExpiresAt.getTime() - Date.now()) / 1000));
  res.cookies.set(ACCESS_COOKIE, session.accessToken, {
    httpOnly: true,
    secure: secure(),
    sameSite: "strict",
    maxAge: ACCESS_TOKEN_TTL_SECONDS,
    path: "/",
  });
  res.cookies.set(REFRESH_COOKIE, session.refreshToken, {
    httpOnly: true,
    secure: secure(),
    sameSite: "strict",
    maxAge: refreshMaxAge,
    path: REFRESH_COOKIE_PATH,
  });
  // Lives as long as the refresh cookie; not HttpOnly (see session-constants.ts).
  res.cookies.set(SIGNED_IN_COOKIE, "1", {
    httpOnly: false,
    secure: secure(),
    sameSite: "strict",
    maxAge: refreshMaxAge,
    path: "/",
  });
}

export function clearSessionCookies(res: NextResponse): void {
  res.cookies.set(ACCESS_COOKIE, "", { httpOnly: true, secure: secure(), sameSite: "strict", maxAge: 0, path: "/" });
  res.cookies.set(REFRESH_COOKIE, "", { httpOnly: true, secure: secure(), sameSite: "strict", maxAge: 0, path: REFRESH_COOKIE_PATH });
  res.cookies.set(SIGNED_IN_COOKIE, "", { httpOnly: false, secure: secure(), sameSite: "strict", maxAge: 0, path: "/" });
}
