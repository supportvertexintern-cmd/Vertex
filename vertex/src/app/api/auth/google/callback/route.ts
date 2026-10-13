import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { limitByIp } from "@/lib/rate-limit";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { setSessionCookies, startSession } from "@/lib/session";
import { emailFingerprint, recordSecurityEvent } from "@/lib/audit";
import { log } from "@/lib/log";

interface GoogleTokenResponse {
  access_token: string;
  id_token: string;
  error?: string;
}

interface GoogleUserInfo {
  sub: string;       // Google's unique user ID
  name: string;
  email: string;
  email_verified: boolean;
  picture: string;
}

export async function GET(req: NextRequest) {
  const limited = limitByIp(req, "google-callback", { windowMs: 15 * 60_000, max: 20 });
  if (limited) return limited;
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state"); // the original redirect destination
  const error = searchParams.get("error");

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const redirectUri = `${appUrl}/api/auth/google/callback`;
  const redirectTo = safeRedirectPath(state);

  if (error || !code) {
    return NextResponse.redirect(`${appUrl}/auth/login?error=google_cancelled`);
  }

  // 1. Exchange auth code for access token
  let tokens: GoogleTokenResponse;
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    tokens = await tokenRes.json();
    if (tokens.error) throw new Error(tokens.error);
  } catch (e) {
    log.warn("auth.google_token_exchange_failed", { err: e });
    return NextResponse.redirect(`${appUrl}/auth/login?error=google_token_failed`);
  }

  // 2. Fetch user info from Google
  let googleUser: GoogleUserInfo;
  try {
    const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    googleUser = await userRes.json();
  } catch (e) {
    log.warn("auth.google_userinfo_failed", { err: e });
    return NextResponse.redirect(`${appUrl}/auth/login?error=google_user_failed`);
  }

  if (!googleUser.email) {
    return NextResponse.redirect(`${appUrl}/auth/login?error=google_no_email`);
  }

  // 3. Find the existing user — never create one here. A candidate
  // account only ever comes into being via the screening invite (Candidate
  // Information Form -> screened -> invite -> set password), so Google
  // sign-in is login-only: it must match an account that already exists,
  // the same way email/password login can't conjure one up either.
  let user = await prisma.user.findFirst({
    where: {
      OR: [
        { google_id: googleUser.sub },
        { email: googleUser.email },
      ],
    },
  });

  if (!user) {
    await recordSecurityEvent("login_failed", {
      actorId: null, entityType: "Auth", entityId: "unknown_account",
      detail: { reason: "unknown_account", method: "google", email_fp: emailFingerprint(googleUser.email) },
    });
    return NextResponse.redirect(`${appUrl}/auth/login?error=google_no_account`);
  }

  if (!user.google_id) {
    // Existing email-registered user signing in with Google for the
    // first time — link their Google account.
    user = await prisma.user.update({
      where: { id: user.id },
      data: { google_id: googleUser.sub, email_verified: true },
    });
  }

  await recordSecurityEvent("login_succeeded", {
    actorId: user.id, entityType: "Auth", entityId: `user:${user.id}`, detail: { method: "google", role: user.role },
  });

  // 4. Start a session (lib/session.ts) and set its cookies
  const session = await startSession(user, req);
  const response = NextResponse.redirect(`${appUrl}${redirectTo}`);
  setSessionCookies(response, session);

  return response;
}
