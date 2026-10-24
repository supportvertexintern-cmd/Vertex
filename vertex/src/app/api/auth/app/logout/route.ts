import { NextRequest } from "next/server";
import { appJson, appPreflight, refreshTokenFromBody } from "@/lib/app-auth";
import { recordSecurityEvent } from "@/lib/audit";
import { limitByIp } from "@/lib/rate-limit";
import { familyOfRefreshToken, revokeFamily } from "@/lib/session";

// Mobile app sign-out (lib/app-auth.ts): body {refreshToken}. Ends the
// session server-side, so its access token stops working at once (FastAPI
// and Next.js both check the session is live). Always answers the same way,
// so it reveals nothing about the token.
export async function POST(req: NextRequest) {
  const limited = limitByIp(req, "auth-app-logout", { windowMs: 60_000, max: 30 });
  if (limited) return limited;
  const family = await familyOfRefreshToken((await refreshTokenFromBody(req)) ?? undefined).catch(() => null);
  if (family) {
    await revokeFamily(family.familyId, "logout", family.userId).catch(() => 0);
    await recordSecurityEvent("logout", {
      actorId: family.userId,
      entityType: "Auth",
      entityId: `user:${family.userId}`,
      detail: { session: family.familyId, client: "app" },
    });
  }
  return appJson(req, { data: { signedOut: true } });
}

export function OPTIONS(req: NextRequest) {
  return appPreflight(req);
}
