import { NextRequest } from "next/server";
import { limitByIp } from "@/lib/rate-limit";
import { passOn, readJson } from "@/lib/pipeline";

// POST /api/referral-agents/register — public, unauthenticated. Same
// anonymous-submission rate limit as /api/contact and /api/applications.
export async function POST(req: NextRequest) {
  const limited = await limitByIp(req, "referral-agent-register", { max: 5, windowMs: 60_000, failClosed: true });
  if (limited) return limited;

  const read = await readJson(req, true);
  if (read.invalid) return read.invalid;

  // FastAPI takes the application since users step 8.4
  // (vertex_be/app/api/v1/referral_agents.py) and signs the verification
  // link; the emails go after the response.
  return passOn("/api/v1/referral-agents/apply", { method: "POST", body: read.body, asUser: false }, { legacyErrors: true });
}
