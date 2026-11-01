import { createHash, createPublicKey, hkdfSync, type KeyObject } from "node:crypto";
import jwt from "jsonwebtoken";
import type { Role } from "@prisma/client";

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
//
// Sessions and the account links (verification, reset, setup, a referral
// agent's verification) are FastAPI's: it signs sessions with a private key
// only it holds, and the links with a secret only it holds (session keys K3,
// docs/architecture/session-keys-handover.md, which closed exception E8).
// This app verifies sessions (below) and signs only these:
export type TokenPurpose =
  | "candidate_invite"
  | "cif_upload"
  | "document"
  // Not a user's token: Next.js's own credential when it calls FastAPI
  // (callBackend(), gap G18). Keyed from SERVICE_AUTH_SECRET instead of
  // JWT_SECRET, so one leaking doesn't give away the other.
  | "service";

const KEY_VERSION: Record<TokenPurpose, number> = {
  candidate_invite: 1,
  cif_upload: 1,
  document: 1,
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

const audience = (purpose: TokenPurpose | "session") => `vertex:${purpose}`;

function sign(purpose: TokenPurpose, payload: object, expiresIn: jwt.SignOptions["expiresIn"]): string {
  return jwt.sign(payload, keyFor(purpose), { expiresIn, algorithm: ALGORITHM, issuer: ISSUER, audience: audience(purpose) });
}

// Throws on a bad signature, expiry, wrong purpose or a payload missing the
// fields its purpose needs. Each key is checked with its one algorithm only.
function verify<T>(
  purpose: TokenPurpose | "session",
  token: string,
  required: (keyof T & string)[],
  key: Buffer | KeyObject,
  algorithm: jwt.Algorithm,
): T {
  const payload = jwt.verify(token, key, {
    algorithms: [algorithm],
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

export interface DocumentTokenPayload {
  storagePath: string;
}

export interface CifUploadTokenPayload {
  candidateId: string;
  type: "cif_upload";
}

// One per FastAPI call (lib/backend.ts), valid for a minute; FastAPI refuses
// any that lives longer than five (vertex_be/app/core/tokens.py).
export function signServiceToken(): string {
  return sign("service", { sub: ISSUER, scope: "backend" }, 60);
}

// Short-lived, single-purpose token granting access to exactly one document
// storage path (SRS FR-1.6 "signed, time-limited access URLs").
export function signDocumentToken(payload: DocumentTokenPayload, expiresInSeconds: number): string {
  return sign("document", payload, expiresInSeconds);
}

// Session keys (docs/architecture/session-keys-handover.md, E8): FastAPI signs
// sessions with an ES256 private key only it holds, and names the key in the
// token's `kid`; SESSION_PUBLIC_KEYS lists the public keys (base64 of each
// PEM, comma-separated), as vertex_be/app/core/session_keys.py reads them.
// Nothing else passes: since step K3 not a session keyed from JWT_SECRET,
// which this app holds and so could have minted.
const SESSION_ALGORITHM = "ES256" as const;
let sessionKeys: { raw: string; byId: Map<string, KeyObject> } | undefined;

// The first 16 characters of the base64url SHA-256 of the key's DER
// SubjectPublicKeyInfo, as session_keys.key_id() computes it.
export function sessionKeyId(key: KeyObject): string {
  return createHash("sha256").update(key.export({ type: "spki", format: "der" })).digest("base64url").slice(0, 16);
}

function sessionPublicKeys(): Map<string, KeyObject> {
  const raw = process.env.SESSION_PUBLIC_KEYS ?? "";
  if (sessionKeys?.raw !== raw) {
    const byId = new Map<string, KeyObject>();
    for (const part of raw.split(",").map((p) => p.trim()).filter(Boolean)) {
      const key = createPublicKey(Buffer.from(part, "base64").toString("utf-8"));
      if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
        throw new Error("SESSION_PUBLIC_KEYS must list P-256 (ES256) public keys");
      }
      byId.set(sessionKeyId(key), key);
    }
    sessionKeys = { raw, byId };
  }
  return sessionKeys.byId;
}

// Tokens from before G19 (no sid/ver) are rejected: those users sign in again.
export function verifyToken(token: string): JwtPayload {
  // The key comes from the listed keys by `kid`, never from the token's alg.
  const header = jwt.decode(token, { complete: true })?.header;
  if (header?.alg !== SESSION_ALGORITHM) throw new jwt.JsonWebTokenError("session token is not ES256");
  const key = sessionPublicKeys().get(String(header.kid));
  if (!key) throw new jwt.JsonWebTokenError("session token names an unknown key");
  const payload = verify<JwtPayload>("session", token, ["userId", "email", "role", "sid"], key, SESSION_ALGORITHM);
  if (!Number.isInteger(payload.ver)) throw new jwt.JsonWebTokenError("session token is missing ver");
  return payload;
}

export function verifyDocumentToken(token: string): DocumentTokenPayload {
  return verify<DocumentTokenPayload>("document", token, ["storagePath"], keyFor("document"), ALGORITHM);
}

// Invites a recruiter-sourced lead to create their own account and link it
// to the Candidate record already gathered about them (SRS FR-2.1/FR-2.4 —
// self-service application submission). 7 days: field candidates may not
// have reliable connectivity the moment this is sent. FastAPI checks it at
// registration (users step 8.3).
export function signCandidateInviteToken(candidateId: string): string {
  return sign("candidate_invite", { candidateId, type: "candidate_invite" }, "7d");
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
  return verify<CifUploadTokenPayload>("cif_upload", token, ["candidateId"], keyFor("cif_upload"), ALGORITHM);
}
