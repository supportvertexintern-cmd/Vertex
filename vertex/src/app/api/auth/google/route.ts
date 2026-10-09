import { NextRequest, NextResponse } from "next/server";
import { limitByIp } from "@/lib/rate-limit";
import { safeRedirectPath } from "@/lib/safe-redirect";

export async function GET(req: NextRequest) {
  const limited = limitByIp(req, "google-signin", { windowMs: 15 * 60_000, max: 20 });
  if (limited) return limited;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const redirectUri = `${appUrl}/api/auth/google/callback`;

  if (!clientId) {
    return NextResponse.json({ error: "Google OAuth not configured" }, { status: 500 });
  }

  // Preserve redirect param so we can use it after Google callback
  const { searchParams } = req.nextUrl;
  const redirectTo = safeRedirectPath(searchParams.get("redirect"));

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    prompt: "select_account",
    state: encodeURIComponent(redirectTo),
  });

  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  return NextResponse.redirect(googleAuthUrl);
}
