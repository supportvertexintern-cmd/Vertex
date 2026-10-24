// Prints the golden vectors in vertex_be/tests/node_session_vectors.py.
// Golden vectors from the real Next.js signing code path (node:crypto HKDF +
// jsonwebtoken), for a TEST-ONLY secret. Run from vertex/ (needs node_modules).
const { hkdfSync } = require("node:crypto");
const jwt = require(require.resolve("jsonwebtoken", { paths: [process.cwd()] }));
const secret = "test-only-jwt-secret-not-used-anywhere-0123456789";
const key = Buffer.from(hkdfSync("sha256", secret, "vertex-token-keys", "vertex/jwt/session/v1", 32));
const token = jwt.sign(
  { userId: "golden-user", email: "golden@test.invalid", role: "admin", sid: "golden-family", ver: 3, iat: 1792800000 },
  key,
  { algorithm: "HS256", issuer: "vertex-web", audience: "vertex:session", expiresIn: 4102444800 - 1792800000 },
);
const reset = Buffer.from(hkdfSync("sha256", secret, "vertex-token-keys", "vertex/jwt/password_reset/v1", 32));
console.log(JSON.stringify({ secret, sessionKeyHex: key.toString("hex"), resetKeyHex: reset.toString("hex"), token,
  resetToken: jwt.sign({ userId: "golden-user", email: "golden@test.invalid", role: "admin", sid: "golden-family", ver: 3, iat: 1792800000 }, reset,
    { algorithm: "HS256", issuer: "vertex-web", audience: "vertex:session", expiresIn: 4102444800 - 1792800000 }) }, null, 1));
