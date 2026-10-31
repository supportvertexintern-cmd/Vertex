import { NextRequest } from "next/server";
import { appJson, appPreflight, refreshTokenFromBody } from "@/lib/app-auth";
import { callBackend } from "@/lib/backend";
import { clientHeaders } from "@/lib/auth-backend";
import { limitByIp } from "@/lib/rate-limit";

// Mobile app sign-out (lib/app-auth.ts): body {refreshToken}. FastAPI ends
// the session server-side (users step 8.2), so its access token stops
// working at once (FastAPI and Next.js both check the session is live).
// Always answers the same way, so it reveals nothing about the token.
export async function POST(req: NextRequest) {
  const limited = await limitByIp(req, "auth-app-logout", { windowMs: 60_000, max: 30 });
  if (limited) return limited;
  await callBackend("/api/v1/auth/logout", {
    method: "POST",
    body: { refresh_token: await refreshTokenFromBody(req), client: "app" },
    asUser: false,
    forward: await clientHeaders(req),
  });
  return appJson(req, { data: { signedOut: true } });
}

export function OPTIONS(req: NextRequest) {
  return appPreflight(req);
}
