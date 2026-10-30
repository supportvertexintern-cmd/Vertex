// Prints the golden vectors in vertex_be/tests/node_session_vectors.py: keys
// and tokens from the real Next.js signing code path (node:crypto HKDF +
// jsonwebtoken, as src/lib/jwt.ts), for a TEST-ONLY secret used nowhere else.
//
//   node scripts/golden-session-vectors.mjs     (from vertex/, after npm ci)
import { hkdfSync } from "node:crypto";
import jwt from "jsonwebtoken";

const secret = "test-only-jwt-secret-not-used-anywhere-0123456789";
const derive = (purpose) => Buffer.from(hkdfSync("sha256", secret, "vertex-token-keys", `vertex/jwt/${purpose}/v1`, 32));
const claims = { userId: "golden-user", email: "golden@test.invalid", role: "admin", sid: "golden-family", ver: 3, iat: 1792800000 };
// Expires 2100-01-01, so the vector stays valid.
const options = { algorithm: "HS256", issuer: "vertex-web", audience: "vertex:session", expiresIn: 4102444800 - 1792800000 };

const sessionKey = derive("session");
const resetKey = derive("password_reset");
// A screening invite (signCandidateInviteToken), for registration's claim.
const inviteKey = derive("candidate_invite");
const invite = { candidateId: "cgoldencandidate01", type: "candidate_invite", iat: 1792800000 };
const link = (purpose, payload) => jwt.sign({ ...payload, iat: 1792800000 }, derive(purpose), { ...options, audience: `vertex:${purpose}` });
console.log(
  JSON.stringify(
    {
      secret,
      sessionKeyHex: sessionKey.toString("hex"),
      resetKeyHex: resetKey.toString("hex"),
      token: jwt.sign(claims, sessionKey, options),
      resetToken: jwt.sign(claims, resetKey, options),
      inviteKeyHex: inviteKey.toString("hex"),
      inviteToken: jwt.sign(invite, inviteKey, { ...options, audience: "vertex:candidate_invite" }),
      // Email links as the website signed them before users step 8.3
      // (signEmailToken, signAccountSetupToken): FastAPI accepts them.
      verificationToken: link("email_verification", { userId: "golden-user", email: "golden@test.invalid", type: "email_verification" }),
      passwordResetToken: link("password_reset", { userId: "golden-user", email: "golden@test.invalid", type: "password_reset" }),
      accountSetupToken: link("account_setup", { userId: "golden-user", type: "account_setup" }),
    },
    null,
    1,
  ),
);
