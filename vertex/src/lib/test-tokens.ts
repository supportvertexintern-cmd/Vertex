import { hkdfSync } from "node:crypto";
import jwt from "jsonwebtoken";
import type { JwtPayload } from "./jwt";

// Tests only. FastAPI signs sessions since users step 8.2 and the account
// links since 8.3 and 8.4 (vertex_be/app/core/tokens.py); this app no longer
// can. Tests make them the same way, with the test run's JWT_SECRET.

/** A token of `purpose`, as vertex_be/app/core/tokens.py signs one. */
export function signAs(purpose: string, payload: object, expiresIn: jwt.SignOptions["expiresIn"] = "15m"): string {
  const key = Buffer.from(hkdfSync("sha256", process.env.JWT_SECRET ?? "", "vertex-token-keys", `vertex/jwt/${purpose}/v1`, 32));
  return jwt.sign(payload, key, { algorithm: "HS256", issuer: "vertex-web", audience: `vertex:${purpose}`, expiresIn });
}

/** A 15-minute access token, as FastAPI's sign_access_token() makes one. */
export function signAccessToken(payload: JwtPayload): string {
  return signAs("session", payload);
}
