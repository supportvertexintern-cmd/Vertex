// Gap G17: one key per token purpose. Every token must be accepted by the
// verifier of its own purpose and rejected by every other one.
import { describe, it, expect, vi } from "vitest";
import { hkdfSync } from "node:crypto";
import jwt from "jsonwebtoken";

const SECRET = vi.hoisted(() => {
  const value = "test-only-signing-value-not-a-real-secret-g17";
  process.env.JWT_SECRET = value;
  return value;
});

import {
  signToken,
  signEmailToken,
  signDocumentToken,
  signCandidateInviteToken,
  signAccountSetupToken,
  signCifUploadToken,
  verifyToken,
  verifyEmailToken,
  verifyDocumentToken,
  verifyCandidateInviteToken,
  verifyAccountSetupToken,
  verifyCifUploadToken,
} from "./jwt";

const signers: Record<string, () => string> = {
  session: () => signToken({ userId: "u1", email: "a@test.invalid", role: "admin", sid: "s1", ver: 0 }),
  email_verification: () => signEmailToken({ userId: "u1", email: "a@test.invalid", type: "email_verification" }),
  password_reset: () => signEmailToken({ userId: "u1", email: "a@test.invalid", type: "password_reset" }),
  candidate_invite: () => signCandidateInviteToken("c1"),
  account_setup: () => signAccountSetupToken("u1"),
  cif_upload: () => signCifUploadToken("c1"),
  document: () => signDocumentToken({ storagePath: "cv/x.pdf" }, 60),
};

const verifiers: Record<string, (t: string) => unknown> = {
  session: verifyToken,
  email_verification: (t) => verifyEmailToken(t, "email_verification"),
  password_reset: (t) => verifyEmailToken(t, "password_reset"),
  candidate_invite: verifyCandidateInviteToken,
  account_setup: verifyAccountSetupToken,
  cif_upload: verifyCifUploadToken,
  document: verifyDocumentToken,
};

const purposes = Object.keys(signers);
const pairs = purposes.flatMap((s) => purposes.filter((v) => v !== s).map((v) => [s, v]));

// The key a token of `purpose` would get under another environment's secret.
const keyUnder = (secret: string, purpose: string) =>
  Buffer.from(hkdfSync("sha256", secret, "vertex-token-keys", `vertex/jwt/${purpose}/v1`, 32));

describe("token purposes (gap G17)", () => {
  it.each(purposes)("a %s token is accepted by its own verifier", (purpose) => {
    expect(() => verifiers[purpose](signers[purpose]())).not.toThrow();
  });

  it.each(pairs)("a %s token is rejected as %s", (signed, checkedAs) => {
    expect(() => verifiers[checkedAs](signers[signed]())).toThrow();
  });

  it.each(purposes)("a %s token signed the pre-G17 way (raw JWT_SECRET) is rejected", (purpose) => {
    const legacy = jwt.sign({ userId: "u1", email: "a@test.invalid", role: "admin", candidateId: "c1", storagePath: "x", type: purpose }, SECRET, { algorithm: "HS256" });
    expect(() => verifiers[purpose](legacy)).toThrow();
  });

  it("an anonymous applicant's upload token is not a session (the bug G17 closed)", () => {
    expect(() => verifyToken(signCifUploadToken("c1"))).toThrow();
  });

  it("a session token without a userId is rejected", () => {
    const key = keyUnder(SECRET, "session");
    const noUser = jwt.sign({ email: "a@test.invalid", role: "admin" }, key, { algorithm: "HS256", issuer: "vertex-web", audience: "vertex:session" });
    expect(() => verifyToken(noUser)).toThrow(/missing userId/);
  });

  it("a session token from before G19 (no session id or version) is rejected", () => {
    const key = keyUnder(SECRET, "session");
    const opts = { algorithm: "HS256" as const, issuer: "vertex-web", audience: "vertex:session" };
    const legacy = jwt.sign({ userId: "u1", email: "a@test.invalid", role: "admin" }, key, opts);
    expect(() => verifyToken(legacy)).toThrow(/missing sid/);
    const noVersion = jwt.sign({ userId: "u1", email: "a@test.invalid", role: "admin", sid: "s1" }, key, opts);
    expect(() => verifyToken(noVersion)).toThrow(/missing ver/);
  });

  it("session access tokens last 15 minutes", () => {
    const claims = jwt.decode(signToken({ userId: "u1", email: "a@test.invalid", role: "admin", sid: "s1", ver: 0 })) as { iat: number; exp: number };
    expect(claims.exp - claims.iat).toBe(900);
  });

  it("a token from another environment (different JWT_SECRET) is rejected", () => {
    const other = "another-environments-secret-value-for-tests-only";
    const key = keyUnder(other, "session");
    const foreign = jwt.sign({ userId: "u1", email: "a@test.invalid", role: "admin" }, key, { algorithm: "HS256", issuer: "vertex-web", audience: "vertex:session" });
    expect(() => verifyToken(foreign)).toThrow();
  });

  it("an unsigned (alg:none) token is rejected", () => {
    const none = jwt.sign({ userId: "u1", email: "a@test.invalid", role: "admin", iss: "vertex-web", aud: "vertex:session" }, "", { algorithm: "none" });
    expect(() => verifyToken(none)).toThrow();
  });

  it("an expired token is rejected", () => {
    expect(() => verifyDocumentToken(signDocumentToken({ storagePath: "cv/x.pdf" }, -1))).toThrow();
  });
});
