import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { signToken } from "@/lib/jwt";

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
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state"); // the original redirect destination
  const error = searchParams.get("error");

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const redirectUri = `${appUrl}/api/auth/google/callback`;
  const redirectTo = state ? decodeURIComponent(state) : "/dashboard";

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
    console.error("Google token exchange error:", e);
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
    console.error("Google userinfo error:", e);
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

  // 4. Sign JWT and set cookie
  const token = signToken({
    userId: user.id,
    email: user.email,
    role: user.role,
  });

  const response = NextResponse.redirect(`${appUrl}${redirectTo}`);
  response.cookies.set("auth_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 7 * 24 * 60 * 60,
    path: "/",
  });

  return response;
}
