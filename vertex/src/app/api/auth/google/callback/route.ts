import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { limitByIp } from "@/lib/rate-limit";
import { setSessionCookies, startSession } from "@/lib/session";
import { auditedPrisma, emailFingerprint, recordSecurityEvent } from "@/lib/audit";
import { checkGoogleState, clearGoogleState } from "@/lib/google-oauth";
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
  const error = searchParams.get("error");

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const redirectUri = `${appUrl}/api/auth/google/callback`;
  // Every answer drops the state cookie: a nonce is good for one callback.
  const redirect = (url: string) => {
    const res = NextResponse.redirect(url);
    clearGoogleState(res);
    return res;
  };
  const failed = async (reason: string, userId: string | null, email: string) => {
    await recordSecurityEvent("login_failed", {
      actorId: null, entityType: "Auth", entityId: userId ? `user:${userId}` : "unknown_account",
      detail: { reason, method: "google", email_fp: emailFingerprint(email) },
    });
  };

  // Only the browser that started this sign-in may finish it (login CSRF):
  // otherwise a link could sign a visitor into someone else's account.
  const redirectTo = checkGoogleState(req, searchParams.get("state"));
  if (redirectTo === null) {
    log.warn("auth.google_state_mismatch", {});
    return redirect(`${appUrl}/auth/login?error=google_state_invalid`);
  }

  if (error || !code) {
    return redirect(`${appUrl}/auth/login?error=google_cancelled`);
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
    return redirect(`${appUrl}/auth/login?error=google_token_failed`);
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
    return redirect(`${appUrl}/auth/login?error=google_user_failed`);
  }

  if (!googleUser.email) {
    return redirect(`${appUrl}/auth/login?error=google_no_email`);
  }

  // 3. Find the existing user — never create one here. A candidate
  // account only ever comes into being via the screening invite (Candidate
  // Information Form -> screened -> invite -> set password), so Google
  // sign-in is login-only: it must match an account that already exists,
  // the same way email/password login can't conjure one up either.
  //
  // An account already linked is found by Google's own id, never by email:
  // another Google account claiming the same address doesn't get in.
  let user = await prisma.user.findUnique({ where: { google_id: googleUser.sub } });

  if (!user) {
    const byEmail = await prisma.user.findUnique({ where: { email: googleUser.email } });
    if (!byEmail) {
      await failed("unknown_account", null, googleUser.email);
      return redirect(`${appUrl}/auth/login?error=google_no_account`);
    }
    // Linking by email trusts Google's word for the address, so only when
    // Google has verified it; and never to an account linked to another
    // Google account.
    if (googleUser.email_verified !== true) {
      await failed("google_email_unverified", byEmail.id, googleUser.email);
      return redirect(`${appUrl}/auth/login?error=google_email_unverified`);
    }
    if (byEmail.google_id) {
      await failed("google_account_mismatch", byEmail.id, googleUser.email);
      return redirect(`${appUrl}/auth/login?error=google_no_account`);
    }
    // Pre-hijack: a password set on an account whose email was never
    // verified may not be the owner's. Linking proves the address, so that
    // password is dropped (its sessions end with it: token_version moves
    // on). The owner signs in with Google from then on; an admin's password
    // reset gives them a password again.
    const unprovenPassword = !byEmail.email_verified && byEmail.password_hash !== null;
    user = await auditedPrisma(byEmail.id).user.update({
      where: { id: byEmail.id },
      data: { google_id: googleUser.sub, email_verified: true, ...(unprovenPassword ? { password_hash: null } : {}) },
    });
    if (unprovenPassword) log.info("auth.google_link_dropped_password", { user_id: user.id });
  }

  await recordSecurityEvent("login_succeeded", {
    actorId: user.id, entityType: "Auth", entityId: `user:${user.id}`, detail: { method: "google", role: user.role },
  });

  // 4. Start a session (lib/session.ts) and set its cookies
  const session = await startSession(user, req);
  const response = redirect(`${appUrl}${redirectTo}`);
  setSessionCookies(response, session);

  return response;
}
