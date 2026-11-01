import { NextRequest } from "next/server";
import { limitByIp } from "@/lib/rate-limit";
import { clientHeaders } from "@/lib/auth-backend";
import { passOn, readJson } from "@/lib/pipeline";

// POST /api/auth/forgot-password — self-service reset request from the
// login page (2026-08-05). Always returns the same generic message
// regardless of whether the email matched a real account, so this can't
// be used to enumerate registered users. FastAPI decides and signs the
// link since users step 8.3 (vertex_be/app/api/v1/accounts.py); the email
// goes from here after the answer, which is the same either way.
export async function POST(req: NextRequest) {
  const limited = await limitByIp(req, "forgot-password", { windowMs: 15 * 60_000, max: 5, failClosed: true });
  if (limited) return limited;
  const read = await readJson(req, true);
  if (read.invalid) return read.invalid;
  return passOn("/api/v1/accounts/forgot-password", { method: "POST", body: read.body, asUser: false, forward: await clientHeaders(req) }, { legacyErrors: true, unwrap: true });
}
