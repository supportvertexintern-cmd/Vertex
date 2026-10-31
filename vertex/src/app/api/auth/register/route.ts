import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { hashPassword } from "@/lib/auth";
import { sendVerificationEmail } from "@/lib/email";
import { registerSchema, completeAccountSetupSchema } from "@/lib/validations";
import { limitByIp, limitedResponse, rateLimit, retryAfter } from "@/lib/rate-limit";
import { clientKey } from "@/lib/client-ip";
import { verifyCandidateInviteToken, verifyAccountSetupToken } from "@/lib/jwt";
import { callBackend } from "@/lib/backend";
import { accountsOnFastApi } from "@/lib/flags";
import { passOn } from "@/lib/pipeline";

import { log } from "@/lib/log";
// Shared by GET (prefill) and POST (actual account creation) — a
// candidate account only ever comes into being via this invite, so both
// need the same "is this token still claimable, and what does the
// Candidate record already know about this person" lookup.
async function lookupClaimableInvite(token: string) {
  const { candidateId } = verifyCandidateInviteToken(token);
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: {
      id: true,
      user_id: true,
      full_name: true,
      email: true,
      phone: true,
      applications: {
        orderBy: { submitted_at: "desc" },
        take: 1,
        select: { current_location_country: { select: { name: true } } },
      },
    },
  });
  if (!candidate || candidate.user_id) return null;
  return candidate;
}

// A staff (system-admin-created) or partner (director-provisioned) User
// row already exists at send time — this only ever resolves whether the
// setup token still points at a claimable (password not yet set) account.
async function lookupClaimableAccountSetup(token: string) {
  const { userId } = verifyAccountSetupToken(token);
  const account = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, full_name: true, email: true, password_hash: true },
  });
  if (!account || account.password_hash) return null;
  return account;
}

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
  // Invite-link lookup: limit guessing of setup tokens.
  const limited = await limitByIp(req, "register-invite", { windowMs: 15 * 60_000, max: 20, failClosed: true });
  if (limited) return limited;
  const setupToken = req.nextUrl.searchParams.get("setup");
  if (setupToken) {
    let account;
    try {
      account = await lookupClaimableAccountSetup(setupToken);
    } catch {
      return NextResponse.json({ error: "This invite link is invalid or has expired." }, { status: 400 });
    }
    if (!account) {
      return NextResponse.json({ error: "This invite has already been used or is no longer valid." }, { status: 410 });
    }
    return NextResponse.json({
      data: { full_name: account.full_name, email: account.email, phone: "", country: "" },
    });
  }

  const token = req.nextUrl.searchParams.get("invite");
  if (!token) {
    return NextResponse.json({ error: "Missing invite token." }, { status: 400 });
  }

  let candidate;
  try {
    candidate = await lookupClaimableInvite(token);
  } catch {
    return NextResponse.json({ error: "This invite link is invalid or has expired." }, { status: 400 });
  }
  if (!candidate) {
    return NextResponse.json({ error: "This invite has already been used or is no longer valid." }, { status: 410 });
  }

  return NextResponse.json({
    data: {
      full_name: candidate.full_name ?? "",
      email: candidate.email ?? "",
      phone: candidate.phone ?? "",
      country: candidate.applications[0]?.current_location_country?.name ?? "",
    },
  });
}

// POST /api/auth/register — there's no general-purpose sign-up anymore:
// every candidate account is created off a screening invite (Candidate
// Information Form -> screened -> invite -> set password here), never
// from scratch. full_name/email/phone/country all come from the
// Candidate record the invite token points at, not from the request
// body, so there's no way to register with details that don't match
// what was actually screened.
export async function POST(req: NextRequest) {
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // FastAPI creates the account and claims the candidate in one transaction
  // since users step 8.3 (vertex_be/app/api/v1/accounts.py), signs the
  // verification link and lists the email, which is sent from here. The
  // code below is the way back, behind FLAG_ACCOUNTS_FASTAPI_REGISTRATION
  // (lib/flags.ts), until step 8.5.
  if (accountsOnFastApi("REGISTRATION")) {
    const setup = typeof body === "object" && body !== null && "setup" in body;
    return passOn(setup ? "/api/v1/accounts/setup" : "/api/v1/accounts/register", { method: "POST", body, asUser: false }, { legacyErrors: true, unwrap: true });
  }

  // A staff/partner account setting its own password for the first time
  // (2026-07-27) is a distinct flow from a candidate's — the User row
  // already exists, so this only ever sets password_hash on it, never
  // creates anything.
  if (typeof body === "object" && body !== null && "setup" in body) {
    const parsedSetup = completeAccountSetupSchema.safeParse(body);
    if (!parsedSetup.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsedSetup.error.flatten().fieldErrors },
        { status: 422 }
      );
    }

    let account;
    try {
      account = await lookupClaimableAccountSetup(parsedSetup.data.setup);
    } catch {
      return NextResponse.json({ error: "This invite link is invalid or has expired." }, { status: 400 });
    }
    if (!account) {
      return NextResponse.json({ error: "This invite has already been used or is no longer valid." }, { status: 410 });
    }

    const password_hash = await hashPassword(parsedSetup.data.password);
    const updated = await auditedPrisma(null).user.update({
      where: { id: account.id },
      data: { password_hash, email_verified: true },
      select: { id: true, full_name: true, email: true, role: true },
    });

    return NextResponse.json(
      { message: "Your password is set — you can now log in.", user: updated },
      { status: 200 }
    );
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  const { password, invite } = parsed.data;

  let candidate;
  try {
    candidate = await lookupClaimableInvite(invite);
  } catch {
    return NextResponse.json({ error: "This invite link is invalid or has expired." }, { status: 400 });
  }
  if (!candidate) {
    return NextResponse.json({ error: "This invite has already been used or is no longer valid." }, { status: 410 });
  }
  if (!candidate.email || !candidate.full_name) {
    return NextResponse.json(
      { error: "Your candidate record is missing required details. Please contact your recruiter." },
      { status: 422 }
    );
  }

  const existing = await prisma.user.findUnique({ where: { email: candidate.email } });
  if (existing) {
    return NextResponse.json(
      { error: "An account with this email already exists. Please log in instead." },
      { status: 409 }
    );
  }

  const password_hash = await hashPassword(password);

  // Self-service creation — no authenticated actor, so actor_id is null.
  const db = auditedPrisma(null);
  const user = await db.user.create({
    data: {
      full_name: candidate.full_name,
      email: candidate.email,
      password_hash,
      phone: candidate.phone ?? undefined,
      country: candidate.applications[0]?.current_location_country?.name ?? undefined,
    },
    select: { id: true, full_name: true, email: true, role: true },
  });

  // The Candidate is FastAPI's since the pipeline switch (step 6.7): it
  // links this account to the candidate the invite was for, checking the
  // invite itself, moves them to guided_to_apply, and to submitted when the
  // form already carried every required document (vertex_be/app/api/v1/
  // candidates.py, claim). Called as this app: nobody is signed in yet.
  const claim = await callBackend("/api/v1/candidates/claim", {
    method: "POST",
    body: { invite, user_id: user.id },
    asUser: false,
  });
  if (!claim.ok) {
    // No half-made account: the User goes again, so the invite can be retried.
    await db.user.delete({ where: { id: user.id } }).catch((err) => log.error("register.rollback_failed", { err }));
    return NextResponse.json({ error: claim.error.message }, { status: claim.status });
  }

  // Awaited (not truly fire-and-forget, despite the name) — on serverless
  // (Vercel) a function instance can freeze right after the response is
  // sent, silently killing an un-awaited async send before it completes.
  await sendVerificationEmail(user.id, user.email, user.full_name).catch((err) => log.error("email.send_failed", { err }));

  return NextResponse.json(
    {
      message: "Account created successfully. Please check your email to verify your account.",
      user,
    },
    { status: 201 }
  );
}
