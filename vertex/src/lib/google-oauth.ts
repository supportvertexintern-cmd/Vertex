import { randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { safeRedirectPath } from "./safe-redirect";

// The OAuth `state` binds Google's callback to the browser that started the
// sign-in (login CSRF): a random nonce goes into a short-lived HttpOnly
// cookie and into `state`, and the callback accepts only a matching pair.
// The page to return to rides along in `state`; it isn't secret, and the
// callback still passes it through safeRedirectPath().
//
// SameSite=Lax, not Strict: the callback is a top-level navigation coming
// back from accounts.google.com, which a Strict cookie wouldn't survive.
export const GOOGLE_STATE_COOKIE = "google_oauth_state";
const COOKIE_PATH = "/api/auth/google";
const STATE_TTL_SECONDS = 10 * 60;

/** A fresh `state` for Google, and the nonce its cookie must hold. */
export function newGoogleState(redirectTo: string): { state: string; nonce: string } {
  const nonce = randomBytes(24).toString("base64url");
  return { state: `${nonce}.${Buffer.from(redirectTo).toString("base64url")}`, nonce };
}

export function setGoogleStateCookie(res: NextResponse, nonce: string): void {
  res.cookies.set(GOOGLE_STATE_COOKIE, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: STATE_TTL_SECONDS,
    path: COOKIE_PATH,
  });
}

/** The page to return to when `state` matches this browser's cookie, else null. */
export function checkGoogleState(req: NextRequest, state: string | null): string | null {
  const [nonce, path] = (state ?? "").split(".");
  const expected = req.cookies.get(GOOGLE_STATE_COOKIE)?.value;
  if (!nonce || !expected) return null;
  const a = Buffer.from(nonce);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return safeRedirectPath(Buffer.from(path ?? "", "base64url").toString("utf8"));
}

/** The nonce is single-use: every callback answer drops it. */
export function clearGoogleState(res: NextResponse): void {
  res.cookies.set(GOOGLE_STATE_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 0, path: COOKIE_PATH });
}
