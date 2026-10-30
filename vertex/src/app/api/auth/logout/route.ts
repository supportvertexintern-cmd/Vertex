import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/api-auth";
import { callBackend } from "@/lib/backend";
import { clientHeaders } from "@/lib/auth-backend";
import { clearSessionCookies, REFRESH_COOKIE } from "@/lib/session";

// Ends this browser's session server-side (G19), not just its cookies: a
// copied refresh token stops working too. The refresh cookie identifies the
// session even when the access token has already expired; without one,
// FastAPI ends the signed-in user's own session (users step 8.2,
// vertex_be/app/api/v1/sessions.py, logout). The cookies go either way.
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  await callBackend("/api/v1/auth/logout", {
    method: "POST",
    body: { refresh_token: req.cookies.get(REFRESH_COOKIE)?.value ?? null, client: "web" },
    // The access token goes only while it's live: FastAPI refuses a dead one.
    asUser: user ? true : false,
    forward: await clientHeaders(req),
  });
  const res = NextResponse.json({ message: "Logged out successfully." });
  clearSessionCookies(res);
  return res;
}
