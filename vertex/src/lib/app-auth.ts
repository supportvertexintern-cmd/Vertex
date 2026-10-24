import { NextRequest, NextResponse } from "next/server";
import type { IssuedSession } from "@/lib/session";

/**
 * Sign-in for the Flutter app (backend plan step 0.6): /api/auth/app/login,
 * /refresh and /logout. Same accounts and sessions as the browser (one
 * RefreshToken family per sign-in, the same rotation, reuse detection and
 * revocation), but the tokens travel in the JSON body instead of cookies:
 * an app has no cookie jar. The app then calls FastAPI with the access token
 * as a Bearer token (vertex_be/app/core/auth.py).
 *
 * These routes never read or set the session cookies. In particular
 * /refresh takes the refresh token from the body only: if it fell back to
 * the HttpOnly cookie, a script injected into the website could trade the
 * cookie for raw tokens.
 *
 * CORS is allowed here only, for the origins in APP_ORIGINS (the Flutter web
 * build; native apps send no Origin), and without credentials.
 */

function allowedOrigins(): Set<string> {
  return new Set(
    (process.env.APP_ORIGINS ?? "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),
  );
}

function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!origin || !allowedOrigins().has(origin)) return { Vary: "Origin" };
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

/** The response for an OPTIONS preflight. */
export function appPreflight(req: NextRequest): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

/** Adds the CORS headers (for an allowed origin) and keeps tokens out of caches. */
export function appResponse(req: NextRequest, res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(corsHeaders(req))) res.headers.set(k, v);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export function appJson(req: NextRequest, body: unknown, status = 200): NextResponse {
  return appResponse(req, NextResponse.json(body, { status }));
}

export interface AppUser {
  id: string;
  email: string;
  role: string;
  full_name?: string;
}

/** {data: {user, accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt}} */
export function appSession(req: NextRequest, user: AppUser, session: IssuedSession, accessTtlSeconds: number): NextResponse {
  return appJson(req, {
    data: {
      user,
      accessToken: session.accessToken,
      accessTokenExpiresAt: new Date(Date.now() + accessTtlSeconds * 1000).toISOString(),
      refreshToken: session.refreshToken,
      refreshTokenExpiresAt: session.refreshExpiresAt.toISOString(),
    },
  });
}

/** The refresh token from a JSON body {refreshToken}, or null. Never the cookie. */
export async function refreshTokenFromBody(req: NextRequest): Promise<string | null> {
  try {
    const body = (await req.json()) as { refreshToken?: unknown };
    return typeof body?.refreshToken === "string" && body.refreshToken ? body.refreshToken : null;
  } catch {
    return null;
  }
}
