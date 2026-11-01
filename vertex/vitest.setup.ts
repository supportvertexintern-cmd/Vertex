import { config } from "dotenv";
import path from "path";
import { generateKeyPairSync } from "node:crypto";

config({ path: path.resolve(__dirname, ".env.test") });

// Session keys K3 (docs/architecture/session-keys-handover.md): the website
// accepts only sessions signed with a key SESSION_PUBLIC_KEYS lists. A fresh
// TEST-ONLY pair per run; lib/test-tokens.ts signs with its private half.
const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const b64 = (pem: string) => Buffer.from(pem).toString("base64");
process.env.SESSION_PUBLIC_KEYS = b64(pair.publicKey.export({ type: "spki", format: "pem" }) as string);
process.env.TEST_SESSION_PRIVATE_KEY = b64(pair.privateKey.export({ type: "pkcs8", format: "pem" }) as string);
process.env.ACCOUNT_LINK_SECRET ??= "test-only-account-link-secret-0123456789abcdef"; // gitleaks:allow
