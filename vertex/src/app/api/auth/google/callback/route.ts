import { NextRequest, NextResponse } from "next/server";
import { limitByIp } from "@/lib/rate-limit";
import { setSessionCookies } from "@/lib/session";
import { callBackend } from "@/lib/backend";
import { alertOnRefusal, clientHeaders, issued, type SignedIn } from "@/lib/auth-backend";
import { checkGoogleState, clearGoogleState } from "@/lib/google-oauth";
import { log } from "@/lib/log";

// Google's way back after sign-in. This route checks the state (only the
// browser that started the sign-in may finish it) and sets the cookies;
// FastAPI exchanges the code with Google, finds or links the account and
// issues the session since users step 8.2 (D3 A; vertex_be/app/api/v1/
// sessions.py, google_sign_in), with #131's rules: a linked account is found
// by Google's id, linking by email needs Google to have verified it, and a
// password nobody proved is dropped.

// FastAPI's refusals, as the codes the login page is sent back with.
const KNOWN_ERRORS = new Set([
  "google_token_failed",
  "google_user_failed",
  "google_no_email",
  "google_no_account",
  "google_email_unverified",
  "google_unavailable",
]);

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

  const result = await callBackend<SignedIn>("/api/v1/auth/google", {
    method: "POST",
    body: { code, redirect_uri: redirectUri },
    asUser: false,
    forward: await clientHeaders(req),
  });
  if (!result.ok) {
    await alertOnRefusal(result);
    const reason = KNOWN_ERRORS.has(result.error.code) ? result.error.code : "google_failed";
    return redirect(`${appUrl}/auth/login?error=${reason}`);
  }

  const response = redirect(`${appUrl}${redirectTo}`);
  setSessionCookies(response, issued(result.body.data.session));
  return response;
}
