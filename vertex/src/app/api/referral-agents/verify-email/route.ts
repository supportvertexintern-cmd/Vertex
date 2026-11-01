import { NextRequest } from "next/server";
import { limitByIp } from "@/lib/rate-limit";
import { passOn } from "@/lib/pipeline";

// GET /api/referral-agents/verify-email — mirrors /api/auth/verify-email,
// but updates ReferralAgent.email_verified. No User/session exists yet at
// this point (the agent isn't approved/provisioned), so this is a public,
// unauthenticated route gated only by the token itself.
export async function GET(req: NextRequest) {
  const limited = await limitByIp(req, "referral-agent-verify-email", { windowMs: 15 * 60_000, max: 10, failClosed: true });
  if (limited) return limited;

  const token = req.nextUrl.searchParams.get("token");

  // FastAPI checks the link and verifies since users step 8.4
  // (vertex_be/app/api/v1/referral_agents.py).
  return passOn("/api/v1/referral-agents/verify-email", { method: "POST", body: { token }, asUser: false }, { legacyErrors: true, unwrap: true });
}
