// Gap G17: one key per token purpose. Every token must be accepted by the
// verifier of its own purpose and rejected by every other one.
import { afterEach, describe, it, expect, vi } from "vitest";
import { createHmac, createPublicKey, generateKeyPairSync, hkdfSync, type KeyObject } from "node:crypto";
import jwt from "jsonwebtoken";

const SECRET = vi.hoisted(() => {
  const value = "test-only-signing-value-not-a-real-secret-g17";
  process.env.JWT_SECRET = value;
  return value;
});

import {
  signDocumentToken,
  signCandidateInviteToken,
  signCifUploadToken,
  sessionKeyId,
  verifyToken,
  verifyDocumentToken,
  verifyCifUploadToken,
} from "./jwt";
import { signAs } from "./test-tokens";

// Sessions and the account links are FastAPI's (users steps 8.2 to 8.4), made
// here as it makes them; the website still verifies sessions (E8).
const signers: Record<string, () => string> = {
  session: () => signAs("session", { userId: "u1", email: "a@test.invalid", role: "admin", sid: "s1", ver: 0 }),
  email_verification: () => signAs("email_verification", { userId: "u1", email: "a@test.invalid", type: "email_verification" }),
  password_reset: () => signAs("password_reset", { userId: "u1", email: "a@test.invalid", type: "password_reset" }),
  account_setup: () => signAs("account_setup", { userId: "u1", type: "account_setup" }),
  referral_agent_email_verification: () => signAs("referral_agent_email_verification", { referralAgentId: "a1", type: "referral_agent_email_verification" }),
  candidate_invite: () => signCandidateInviteToken("c1"),
  cif_upload: () => signCifUploadToken("c1"),
  document: () => signDocumentToken({ storagePath: "cv/x.pdf" }, 60),
};

// The tokens this app still checks.
const verifiers: Record<string, (t: string) => unknown> = {
  session: verifyToken,
  cif_upload: verifyCifUploadToken,
  document: verifyDocumentToken,
};

const purposes = Object.keys(signers);
const checked = Object.keys(verifiers);
const pairs = purposes.flatMap((s) => checked.filter((v) => v !== s).map((v) => [s, v]));

// The key a token of `purpose` would get under another environment's secret.
const keyUnder = (secret: string, purpose: string) =>
  Buffer.from(hkdfSync("sha256", secret, "vertex-token-keys", `vertex/jwt/${purpose}/v1`, 32));

describe("token purposes (gap G17)", () => {
  it.each(checked)("a %s token is accepted by its own verifier", (purpose) => {
    expect(() => verifiers[purpose](signers[purpose]())).not.toThrow();
  });

  it.each(pairs)("a %s token is rejected as %s", (signed, checkedAs) => {
    expect(() => verifiers[checkedAs](signers[signed]())).toThrow();
  });

  it.each(checked)("a %s token signed the pre-G17 way (raw JWT_SECRET) is rejected", (purpose) => {
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

// Session keys K1 (docs/architecture/session-keys-handover.md): FastAPI will
// sign sessions with an ES256 key only it holds; the shared key still passes
// until K3. GOLDEN_* is vertex_be/tests/node_session_vectors.py's vector, made
// by FastAPI's code with a test-only key whose private half was thrown away.
const GOLDEN_PUBLIC = "LS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS0KTUZrd0V3WUhLb1pJemowQ0FRWUlLb1pJemowREFRY0RRZ0FFSUN4VFdUQy9yWDVvcnZ3TjkvZXBHd055TG05KwpwVE1ZUndRcUlUQllvZUJVbUl1SjhGYkNxTTZwNXQwNzlxUG85eXRtNkxjbllXTTVIZmhIYzZ0b2VnPT0KLS0tLS1FTkQgUFVCTElDIEtFWS0tLS0tCg=="; // gitleaks:allow
const GOLDEN_TOKEN = "eyJhbGciOiJFUzI1NiIsImtpZCI6IkplR1AzRXFhanFncjNHTUsiLCJ0eXAiOiJKV1QifQ.eyJ1c2VySWQiOiJnb2xkZW4tdXNlciIsImVtYWlsIjoiZ29sZGVuQHRlc3QuaW52YWxpZCIsInJvbGUiOiJhZG1pbiIsInNpZCI6ImdvbGRlbi1mYW1pbHkiLCJ2ZXIiOjMsImlhdCI6MTc5MjgwMDAwMCwiZXhwIjo0MTAyNDQ0ODAwLCJpc3MiOiJ2ZXJ0ZXgtd2ViIiwiYXVkIjoidmVydGV4OnNlc3Npb24ifQ.EPmmlByMPIdLFjDUHam1Ry-q2c0Jyl1s5ypNJucABVVepkeuRI414sXqGu6hstDJqLZlptpR_x3obzh3lmwloQ"; // gitleaks:allow

describe("ES256 sessions (session keys K1)", () => {
  const newKey = (namedCurve = "prime256v1") => generateKeyPairSync("ec", { namedCurve });
  const b64 = (key: KeyObject) => Buffer.from(key.export({ type: "spki", format: "pem" }) as string).toString("base64");
  const claims = { userId: "u1", email: "a@test.invalid", role: "admin", sid: "s1", ver: 0 };
  const opts = { issuer: "vertex-web", audience: "vertex:session", expiresIn: 900 } as const;
  const es256 = (key: KeyObject, kid: string, payload: object = claims) => jwt.sign(payload, key, { ...opts, algorithm: "ES256", keyid: kid });
  const current = newKey();
  const previous = newKey();
  const listed = (...keys: KeyObject[]) => {
    process.env.SESSION_PUBLIC_KEYS = keys.map(b64).join(", ");
  };
  afterEach(() => {
    delete process.env.SESSION_PUBLIC_KEYS;
  });

  it("accepts FastAPI's golden vector, with the same key id", () => {
    process.env.SESSION_PUBLIC_KEYS = GOLDEN_PUBLIC;
    expect(sessionKeyId(createPublicKey(Buffer.from(GOLDEN_PUBLIC, "base64").toString()))).toBe("JeGP3Eqajqgr3GMK");
    expect(verifyToken(GOLDEN_TOKEN)).toMatchObject({ userId: "golden-user", sid: "golden-family", ver: 3 });
  });

  it("accepts a token from any listed key (current and previous)", () => {
    listed(current.publicKey, previous.publicKey);
    expect(verifyToken(es256(current.privateKey, sessionKeyId(current.publicKey))).userId).toBe("u1");
    expect(verifyToken(es256(previous.privateKey, sessionKeyId(previous.publicKey))).userId).toBe("u1");
  });

  it("still accepts a shared-key session until K3", () => {
    listed(current.publicKey);
    expect(verifyToken(signers.session()).userId).toBe("u1");
  });

  it("refuses an unlisted key, an unknown key id, and another key under a listed id", () => {
    listed(current.publicKey);
    const stranger = newKey();
    expect(() => verifyToken(es256(stranger.privateKey, sessionKeyId(stranger.publicKey)))).toThrow(/unknown key/);
    expect(() => verifyToken(es256(current.privateKey, "nope"))).toThrow(/unknown key/);
    expect(() => verifyToken(jwt.sign(claims, current.privateKey, { ...opts, algorithm: "ES256" }))).toThrow(/unknown key/);
    expect(() => verifyToken(es256(stranger.privateKey, sessionKeyId(current.publicKey)))).toThrow(/invalid signature/);
  });

  it("refuses the public key used as an HMAC secret, under either header", () => {
    listed(current.publicKey);
    const pem = current.publicKey.export({ type: "spki", format: "pem" }) as string;
    const kid = sessionKeyId(current.publicKey);
    for (const alg of ["HS256", "ES256"]) {
      const head = Buffer.from(JSON.stringify({ alg, kid })).toString("base64url");
      const body = Buffer.from(JSON.stringify({ ...claims, iss: "vertex-web", aud: "vertex:session", exp: 4102444800 })).toString("base64url");
      const sig = createHmac("sha256", pem).update(`${head}.${body}`).digest("base64url");
      expect(() => verifyToken(`${head}.${body}.${sig}`), alg).toThrow();
    }
  });

  it("keeps every other session rule", () => {
    listed(current.publicKey);
    const kid = sessionKeyId(current.publicKey);
    expect(() => verifyToken(jwt.sign(claims, current.privateKey, { ...opts, algorithm: "ES256", keyid: kid, audience: "vertex:document" }))).toThrow();
    expect(() => verifyToken(es256(current.privateKey, kid, { ...claims, sid: "" }))).toThrow(/missing sid/);
    expect(() => verifyToken(es256(current.privateKey, kid, { ...claims, ver: "0" }))).toThrow(/missing ver/);
  });

  it("refuses a listed key that isn't P-256", () => {
    process.env.SESSION_PUBLIC_KEYS = b64(newKey("secp384r1").publicKey);
    expect(() => verifyToken(GOLDEN_TOKEN)).toThrow(/P-256/);
  });
});
