import { NextRequest } from "next/server";
import { limitByIp } from "@/lib/rate-limit";
import { passOn } from "@/lib/pipeline";

// FastAPI checks the link and verifies since users step 8.3
// (vertex_be/app/api/v1/accounts.py).
export async function GET(req: NextRequest) {
  const limited = await limitByIp(req, "verify-email", { windowMs: 15 * 60_000, max: 10, failClosed: true });
  if (limited) return limited;
  const token = req.nextUrl.searchParams.get("token");
  return passOn("/api/v1/accounts/verify-email", { method: "POST", body: { token }, asUser: false }, { legacyErrors: true, unwrap: true });
}
