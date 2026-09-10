import jwt from "jsonwebtoken";
import type { Role } from "@prisma/client";

const JWT_SECRET = process.env.JWT_SECRET!;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";
const EMAIL_TOKEN_EXPIRES_IN = process.env.EMAIL_TOKEN_EXPIRES_IN || "24h";

// Pinned explicitly rather than left to jsonwebtoken's default inference
// — defense in depth against algorithm-confusion attacks (a token crafted
// with alg:none or a mismatched algorithm) even though the library's own
// default already restricts to HMAC variants when given a string secret.
const ALGORITHM = "HS256" as const;

export interface JwtPayload {
  userId: string;
  email: string;
  role: Role;
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

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN, algorithm: ALGORITHM } as jwt.SignOptions);
}

export function signEmailToken(payload: EmailTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: EMAIL_TOKEN_EXPIRES_IN, algorithm: ALGORITHM } as jwt.SignOptions);
}

// Short-lived, single-purpose token granting access to exactly one document
// storage path (SRS FR-1.6 "signed, time-limited access URLs").
export function signDocumentToken(payload: DocumentTokenPayload, expiresInSeconds: number): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: expiresInSeconds, algorithm: ALGORITHM } as jwt.SignOptions);
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET, { algorithms: [ALGORITHM] }) as JwtPayload;
}

export function verifyEmailToken(token: string): EmailTokenPayload {
  return jwt.verify(token, JWT_SECRET, { algorithms: [ALGORITHM] }) as EmailTokenPayload;
}

export function verifyDocumentToken(token: string): DocumentTokenPayload {
  return jwt.verify(token, JWT_SECRET, { algorithms: [ALGORITHM] }) as DocumentTokenPayload;
}

// Invites a recruiter-sourced lead to create their own account and link it
// to the Candidate record already gathered about them (SRS FR-2.1/FR-2.4 —
// self-service application submission). 7 days: field candidates may not
// have reliable connectivity the moment this is sent.
export function signCandidateInviteToken(candidateId: string): string {
  return jwt.sign({ candidateId, type: "candidate_invite" }, JWT_SECRET, { expiresIn: "7d", algorithm: ALGORITHM });
}

export function verifyCandidateInviteToken(token: string): CandidateInviteTokenPayload {
  return jwt.verify(token, JWT_SECRET, { algorithms: [ALGORITHM] }) as CandidateInviteTokenPayload;
}

// Invites a staff member (system-admin-created) or a partner (director-
// provisioned) to set their own password, replacing the old "temp password
// shown once" pattern for both. Unlike signCandidateInviteToken, the User
// row already exists at send time (the account itself, role/assignment
// already set) — this token only ever needs to authorize setting
// password_hash on it, not creating anything. 7 days, same reasoning as
// the candidate invite (the recipient may not open email immediately).
export function signAccountSetupToken(userId: string): string {
  return jwt.sign({ userId, type: "account_setup" }, JWT_SECRET, { expiresIn: "7d", algorithm: ALGORITHM });
}

export function verifyAccountSetupToken(token: string): AccountSetupTokenPayload {
  return jwt.verify(token, JWT_SECRET, { algorithms: [ALGORITHM] }) as AccountSetupTokenPayload;
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
  return jwt.sign({ candidateId, type: "cif_upload" }, JWT_SECRET, {
    expiresIn: CIF_UPLOAD_TOKEN_TTL_SECONDS,
    algorithm: ALGORITHM,
  });
}

export function verifyCifUploadToken(token: string): CifUploadTokenPayload {
  return jwt.verify(token, JWT_SECRET, { algorithms: [ALGORITHM] }) as CifUploadTokenPayload;
}
