import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/api-auth";
import { recordSecurityEvent } from "@/lib/audit";
import { clearSessionCookies, familyOfRefreshToken, REFRESH_COOKIE, revokeFamily } from "@/lib/session";

// Ends this browser's session server-side (G19), not just its cookies: a
// copied refresh token stops working too. The refresh cookie identifies the
// session even when the access token has already expired.
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const family = await familyOfRefreshToken(req.cookies.get(REFRESH_COOKIE)?.value).catch(() => null);
  const familyId = family?.familyId ?? user?.sid ?? null;
  const userId = family?.userId ?? user?.userId ?? null;
  if (familyId && userId) {
    await revokeFamily(familyId, "logout", userId).catch(() => 0);
    await recordSecurityEvent("logout", { actorId: userId, entityType: "Auth", entityId: `user:${userId}`, detail: { session: familyId } });
  }
  const res = NextResponse.json({ message: "Logged out successfully." });
  clearSessionCookies(res);
  return res;
}
