import { NextRequest } from "next/server";
import { limitByIp } from "@/lib/rate-limit";
import { clientHeaders } from "@/lib/auth-backend";
import { passOn, readJson } from "@/lib/pipeline";

// POST /api/auth/reset-password — consumes the emailed reset link
// (2026-08-05). No authenticated session required — the link is the
// access grant. FastAPI checks it and sets the password since users step
// 8.3 (vertex_be/app/api/v1/accounts.py); a link works once.
export async function POST(req: NextRequest) {
  const limited = await limitByIp(req, "reset-password", { windowMs: 15 * 60_000, max: 10 });
  if (limited) return limited;
  const read = await readJson(req, true);
  if (read.invalid) return read.invalid;
  return passOn("/api/v1/accounts/reset-password", { method: "POST", body: read.body, asUser: false, forward: await clientHeaders(req) }, { legacyErrors: true, unwrap: true });
}
