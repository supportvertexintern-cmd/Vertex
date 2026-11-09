import { NextRequest, NextResponse } from "next/server";
import { refuseBlocked } from "@/lib/address-controls";
import { limitByIp, limitedResponse, rateLimit, retryAfter } from "@/lib/rate-limit";
import { clientKey } from "@/lib/client-ip";
import { passOn, readJson } from "@/lib/pipeline";

// Accounts are FastAPI's since users step 8.3 (vertex_be/app/api/v1/
// accounts.py): it checks the invite or setup link, creates the account and
// claims the candidate in one transaction, and signs the verification link.
// This route keeps the per-address limits and sends the email it lists.

// GET /api/auth/register?invite=<token> — lets the register page prefill
// itself from the Candidate Information Form data already on file, so a
// screened candidate only has to set a password rather than retype
// everything a recruiter/the candidate themself already submitted.
// Public (no session yet) — the invite token itself is the credential.
//
// GET /api/auth/register?setup=<token> — the equivalent flow for a staff
// or partner account an admin/director already created (2026-07-27):
// same prefill-then-set-password shape, but resolving a User directly
// instead of a not-yet-existing Candidate.
export async function GET(req: NextRequest) {
  // An admin's address block (login protection PR 5): 403 before anything else.
  const blocked = await refuseBlocked(req);
  if (blocked) return blocked;
  // Invite-link lookup: limit guessing of setup tokens.
  const limited = await limitByIp(req, "register-invite", { windowMs: 15 * 60_000, max: 20, failClosed: true });
  if (limited) return limited;
  const setupToken = req.nextUrl.searchParams.get("setup");
  const [path, token] = setupToken
    ? ["/api/v1/accounts/setup", setupToken]
    : ["/api/v1/accounts/register", req.nextUrl.searchParams.get("invite") ?? ""];
  return passOn(path, { query: { token }, asUser: false }, { legacyErrors: true });
}

// POST /api/auth/register — there's no general-purpose sign-up anymore:
// every candidate account is created off a screening invite (Candidate
// Information Form -> screened -> invite -> set password here), never
// from scratch. full_name/email/phone/country all come from the
// Candidate record the invite token points at, not from the request
// body. A body with `setup` is a staff or partner account setting its
// first password instead.
export async function POST(req: NextRequest) {
  // An admin's address block (login protection PR 5): 403 before anything else.
  const blocked = await refuseBlocked(req);
  if (blocked) return blocked;
  // Rate limit: 5 registrations per minute per IP
  const ip = clientKey(req.headers);
  const rl = await rateLimit(`register:${ip}`, { max: 5, failClosed: true });
  if (rl.unavailable) return limitedResponse(rl);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many registration attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": retryAfter(rl) } }
    );
  }

  const read = await readJson(req, true);
  if (read.invalid) return read.invalid;
  const body = read.body;
  const setup = typeof body === "object" && body !== null && "setup" in body;
  return passOn(setup ? "/api/v1/accounts/setup" : "/api/v1/accounts/register", { method: "POST", body, asUser: false }, { legacyErrors: true, unwrap: true });
}
