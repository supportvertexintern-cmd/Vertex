import { hkdfSync } from "node:crypto";
import jwt from "jsonwebtoken";
import type { Role } from "@prisma/client";

// Access tokens are short-lived; sessions last through refresh tokens
// (lib/session.ts, G19). Fixed in code: a long value would reopen the gap.
const ACCESS_TOKEN_EXPIRES_IN = "15m";
const EMAIL_TOKEN_EXPIRES_IN = process.env.EMAIL_TOKEN_EXPIRES_IN || "24h";

// Pinned explicitly rather than left to jsonwebtoken's default inference
// — defense in depth against algorithm-confusion attacks (a token crafted
// with alg:none or a mismatched algorithm) even though the library's own
// default already restricts to HMAC variants when given a string secret.
const ALGORITHM = "HS256" as const;
const ISSUER = "vertex-web";

// Gap G17 (docs/security/phase2-baseline.md): every token type used to be
// signed with JWT_SECRET itself, and no verifier checked the type — so any
// token passed for any other. An anonymous applicant's CIF upload token
// worked as a session cookie, and with no userId in it Prisma dropped the
// `user_id` filter on /api/payments/me.
//
// Now each purpose has its own key, derived from JWT_SECRET with HKDF (one
// secret to manage per environment, independent keys per purpose), and its
// own audience. A token is only ever accepted by the verifier of the purpose
// it was signed for. Bump a purpose's version to invalidate all of its
// outstanding tokens without touching the others.
export type TokenPurpose =
  | "session"
  | "email_verification"
  | "password_reset"
  | "candidate_invite"
  | "account_setup"
  | "cif_upload"
  | "document"
  | "referral_agent_email_verification"
  // Not a user's token: Next.js's own credential when it calls FastAPI
  // (callBackend(), gap G18). Keyed from SERVICE_AUTH_SECRET instead of
  // JWT_SECRET, so one leaking doesn't give away the other.
  | "service";

const KEY_VERSION: Record<TokenPurpose, number> = {
  session: 1,
  email_verification: 1,
  password_reset: 1,
  candidate_invite: 1,
  account_setup: 1,
  cif_upload: 1,
  document: 1,
  referral_agent_email_verification: 1,
  service: 1,
};

const keys = new Map<TokenPurpose, Buffer>();

function keyFor(purpose: TokenPurpose): Buffer {
  let key = keys.get(purpose);
  if (!key) {
    const name = purpose === "service" ? "SERVICE_AUTH_SECRET" : "JWT_SECRET";
    const secret = process.env[name];
    if (!secret || secret.length < 32) throw new Error(`${name} must be set (at least 32 characters)`);
    const info = `vertex/jwt/${purpose}/v${KEY_VERSION[purpose]}`;
    key = Buffer.from(hkdfSync("sha256", secret, "vertex-token-keys", info, 32));
    keys.set(purpose, key);
  }
  return key;
}

const audience = (purpose: TokenPurpose) => `vertex:${purpose}`;

function sign(purpose: TokenPurpose, payload: object, expiresIn: jwt.SignOptions["expiresIn"]): string {
  return jwt.sign(payload, keyFor(purpose), { expiresIn, algorithm: ALGORITHM, issuer: ISSUER, audience: audience(purpose) });
}

// Throws on a bad signature, expiry, wrong purpose or a payload missing the
// fields its purpose needs.
function verify<T>(purpose: TokenPurpose, token: string, required: (keyof T & string)[]): T {
  const payload = jwt.verify(token, keyFor(purpose), {
    algorithms: [ALGORITHM],
    issuer: ISSUER,
    audience: audience(purpose),
  }) as Record<string, unknown>;
  for (const field of required) {
    if (typeof payload[field] !== "string" || payload[field] === "") {
      throw new jwt.JsonWebTokenError(`${purpose} token is missing ${field}`);
    }
  }
  return payload as T;
}

export interface JwtPayload {
  userId: string;
  email: string;
  role: Role;
  // The session (refresh-token family) and the user's token_version at
  // issue; both are checked against the database on every request.
  sid: string;
  ver: number;
}

export interface EmailTokenPayload {
  userId: string;
  email: string;
  type: "email_verification" | "password_reset";
}

export interface DocumentTokenPayload {
  storagePath: string;
}

export interface CandidateInviteTokenPayload {
  candidateId: string;
  type: "candidate_invite";
}

export interface AccountSetupTokenPayload {
  userId: string;
  type: "account_setup";
}

export interface CifUploadTokenPayload {
  candidateId: string;
  type: "cif_upload";
}

export interface ReferralAgentEmailVerificationTokenPayload {
  referralAgentId: string;
  type: "referral_agent_email_verification";
}

// One per FastAPI call (lib/backend.ts), valid for a minute; FastAPI refuses
// any that lives longer than five (vertex_be/app/core/tokens.py).
export function signServiceToken(): string {
  return sign("service", { sub: ISSUER, scope: "backend" }, 60);
}

export function signToken(payload: JwtPayload): string {
  return sign("session", payload, ACCESS_TOKEN_EXPIRES_IN);
}

export function signEmailToken(payload: EmailTokenPayload): string {
  return sign(payload.type, payload, EMAIL_TOKEN_EXPIRES_IN as jwt.SignOptions["expiresIn"]);
}

// Short-lived, single-purpose token granting access to exactly one document
// storage path (SRS FR-1.6 "signed, time-limited access URLs").
export function signDocumentToken(payload: DocumentTokenPayload, expiresInSeconds: number): string {
  return sign("document", payload, expiresInSeconds);
}

// Tokens from before G19 (no sid/ver) are rejected: those users sign in again.
export function verifyToken(token: string): JwtPayload {
  const payload = verify<JwtPayload>("session", token, ["userId", "email", "role", "sid"]);
  if (!Number.isInteger(payload.ver)) throw new jwt.JsonWebTokenError("session token is missing ver");
  return payload;
}

// The caller says which kind it expects: verification and reset links are
// signed with different keys, so one can't be replayed as the other.
export function verifyEmailToken(token: string, type: EmailTokenPayload["type"]): EmailTokenPayload {
  return verify<EmailTokenPayload>(type, token, ["userId", "email", "type"]);
}

export function verifyDocumentToken(token: string): DocumentTokenPayload {
  return verify<DocumentTokenPayload>("document", token, ["storagePath"]);
}

// Invites a recruiter-sourced lead to create their own account and link it
// to the Candidate record already gathered about them (SRS FR-2.1/FR-2.4 —
// self-service application submission). 7 days: field candidates may not
// have reliable connectivity the moment this is sent.
export function signCandidateInviteToken(candidateId: string): string {
  return sign("candidate_invite", { candidateId, type: "candidate_invite" }, "7d");
}

export function verifyCandidateInviteToken(token: string): CandidateInviteTokenPayload {
  return verify<CandidateInviteTokenPayload>("candidate_invite", token, ["candidateId"]);
}

// Invites a staff member (system-admin-created) or a partner (director-
// provisioned) to set their own password, replacing the old "temp password
// shown once" pattern for both. Unlike signCandidateInviteToken, the User
// row already exists at send time (the account itself, role/assignment
// already set) — this token only ever needs to authorize setting
// password_hash on it, not creating anything. 7 days, same reasoning as
// the candidate invite (the recipient may not open email immediately).
export function signAccountSetupToken(userId: string): string {
  return sign("account_setup", { userId, type: "account_setup" }, "7d");
}

export function verifyAccountSetupToken(token: string): AccountSetupTokenPayload {
  return verify<AccountSetupTokenPayload>("account_setup", token, ["userId"]);
}

// Grants the *same browser session* that just submitted the CIF permission
// to upload real documents for the candidate it created, in the window
// before the emailed invite is ever claimed (2026-08-06) — an anonymous
// self-applicant has no session and no User account yet at that point, so
// this is the access grant instead, scoped to exactly one candidate.
// Mirrors signDocumentToken's pattern (narrow, single-purpose, short-
// lived) applied to the write side rather than reads. 4 hours: long
// enough to finish attaching documents in one sitting, short enough that
// a leaked/logged token isn't a standing risk.
const CIF_UPLOAD_TOKEN_TTL_SECONDS = 4 * 60 * 60;

export function signCifUploadToken(candidateId: string): string {
  return sign("cif_upload", { candidateId, type: "cif_upload" }, CIF_UPLOAD_TOKEN_TTL_SECONDS);
}

export function verifyCifUploadToken(token: string): CifUploadTokenPayload {
  return verify<CifUploadTokenPayload>("cif_upload", token, ["candidateId"]);
}

// Verifies a public Referral Agent applicant's email address before admin
// can approve them (2026-08-29) — no User/session exists yet at this point,
// same no-account-required shape as signCandidateInviteToken. 24h, matching
// EMAIL_TOKEN_EXPIRES_IN's existing email-verification precedent rather
// than the 7-day invite-token TTL, since this is sent immediately after a
// registration the applicant just submitted themselves (not a delayed
// staff-initiated invite).
export function signReferralAgentEmailVerificationToken(referralAgentId: string): string {
  return sign(
    "referral_agent_email_verification",
    { referralAgentId, type: "referral_agent_email_verification" },
    EMAIL_TOKEN_EXPIRES_IN as jwt.SignOptions["expiresIn"]
  );
}

export function verifyReferralAgentEmailVerificationToken(token: string): ReferralAgentEmailVerificationTokenPayload {
  return verify<ReferralAgentEmailVerificationTokenPayload>("referral_agent_email_verification", token, ["referralAgentId"]);
}
