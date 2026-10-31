import type { NextResponse } from "next/server";
import { prisma } from "./prisma";

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
// This app still checks every API request against the database
// (getAuthUser in api-auth.ts, with loadSession below): the user must still
// exist, token_version must match, and the family must still have a live
// token. So revoking a family, deleting a user or changing a password or
// role (a database trigger bumps token_version) stops access on the very
// next request, not when the token expires.

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

/**
 * The live session behind an access token: the user as the database has
 * them now, or null if the user is gone, the version moved on, or the
 * family has no live token.
 */
export async function loadSession(userId: string, familyId: string, version: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      role: true,
      token_version: true,
      refresh_tokens: {
        where: { family_id: familyId, revoked_at: null, used_at: null, expires_at: { gt: new Date() } },
        select: { id: true },
        take: 1,
      },
    },
  });
  if (!user) return { user: null, reason: "user_gone" as const };
  if (user.token_version !== version) return { user: null, reason: "version_changed" as const };
  if (!user.refresh_tokens.length) return { user: null, reason: "session_ended" as const };
  return { user, reason: null };
}

// --- cookies ---------------------------------------------------------------

function secure(): boolean {
  return process.env.NODE_ENV === "production";
}

export function setSessionCookies(res: NextResponse, session: IssuedSession): void {
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
    maxAge: Math.max(0, Math.floor((session.refreshExpiresAt.getTime() - Date.now()) / 1000)),
    path: REFRESH_COOKIE_PATH,
  });
  // Lives as long as the refresh cookie; not HttpOnly (see session-constants.ts).
  res.cookies.set(SIGNED_IN_COOKIE, "1", {
    httpOnly: false,
    secure: secure(),
    sameSite: "strict",
    maxAge: Math.max(0, Math.floor((session.refreshExpiresAt.getTime() - Date.now()) / 1000)),
    path: "/",
  });
}

export function clearSessionCookies(res: NextResponse): void {
  res.cookies.set(ACCESS_COOKIE, "", { httpOnly: true, secure: secure(), sameSite: "strict", maxAge: 0, path: "/" });
  res.cookies.set(REFRESH_COOKIE, "", { httpOnly: true, secure: secure(), sameSite: "strict", maxAge: 0, path: REFRESH_COOKIE_PATH });
  res.cookies.set(SIGNED_IN_COOKIE, "", { httpOnly: false, secure: secure(), sameSite: "strict", maxAge: 0, path: "/" });
}
