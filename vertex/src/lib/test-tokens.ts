import { createPrivateKey, createPublicKey, hkdfSync } from "node:crypto";
import jwt from "jsonwebtoken";
import { sessionKeyId, type JwtPayload } from "./jwt";

// Tests only. FastAPI signs sessions with a private key only it holds, and
// the account links with a secret only it holds (session keys K3,
// vertex_be/app/core/tokens.py); this app can do neither. Tests make them the
// same way: sessions with the run's test key (vitest.setup.ts, or a stack's
// keys under Playwright), links from ACCOUNT_LINK_SECRET.

const ACCOUNT_LINKS = new Set(["email_verification", "password_reset", "account_setup", "referral_agent_email_verification"]);

/** A token of an HS256 `purpose`, keyed as vertex_be/app/core/tokens.py keys it. */
export function signAs(purpose: string, payload: object, expiresIn: jwt.SignOptions["expiresIn"] = "15m", secret?: string): string {
  const from = secret ?? (ACCOUNT_LINKS.has(purpose) ? process.env.ACCOUNT_LINK_SECRET : process.env.JWT_SECRET) ?? "";
  const key = Buffer.from(hkdfSync("sha256", from, "vertex-token-keys", `vertex/jwt/${purpose}/v1`, 32));
  return jwt.sign(payload, key, { algorithm: "HS256", issuer: "vertex-web", audience: `vertex:${purpose}`, expiresIn });
}

/** A 15-minute access token, as FastAPI's sign_session_token() makes one. */
export function signAccessToken(payload: JwtPayload): string {
  const pem = Buffer.from(process.env.TEST_SESSION_PRIVATE_KEY ?? "", "base64").toString("utf-8");
  const key = createPrivateKey(pem);
  return jwt.sign(payload, key, { algorithm: "ES256", keyid: sessionKeyId(createPublicKey(key)), issuer: "vertex-web", audience: "vertex:session", expiresIn: "15m" });
}
