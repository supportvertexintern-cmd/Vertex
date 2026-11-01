// Rollback safety for users steps 8.3 and 8.4: what FastAPI writes must still work if
// the website takes the account or referral agent routes back (a flag set to "false", or the
// merge reverted). Vectors made by vertex_be/app/core/tokens.py and
// app/services/sessions.py, with the TEST-ONLY secret of
// vertex_be/tests/node_session_vectors.py; they expire in 2100.
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.JWT_SECRET = "test-only-jwt-secret-not-used-anywhere-0123456789"; // gitleaks:allow
});

import { comparePassword } from "@/lib/auth";
import { verifyAccountSetupToken, verifyEmailToken, verifyReferralAgentEmailVerificationToken } from "@/lib/jwt";

const VERIFICATION = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJnb2xkZW4tdXNlciIsImVtYWlsIjoiZ29sZGVuQHRlc3QuaW52YWxpZCIsInR5cGUiOiJlbWFpbF92ZXJpZmljYXRpb24iLCJpYXQiOjE3OTI4MDAwMDAsImV4cCI6NDEwMjQ0NDgwMCwiaXNzIjoidmVydGV4LXdlYiIsImF1ZCI6InZlcnRleDplbWFpbF92ZXJpZmljYXRpb24ifQ.VdclRyo3fbn17XVUh82rvX7OZzDnhee_mL1-pJxnSnM"; // gitleaks:allow
const RESET = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJnb2xkZW4tdXNlciIsImVtYWlsIjoiZ29sZGVuQHRlc3QuaW52YWxpZCIsInR5cGUiOiJwYXNzd29yZF9yZXNldCIsInB3ZCI6IjkwMzFhNmNiYTI1ZTRkNTRhN2ExMjAyNjE3ZThiYjg4IiwiaWF0IjoxNzkyODAwMDAwLCJleHAiOjQxMDI0NDQ4MDAsImlzcyI6InZlcnRleC13ZWIiLCJhdWQiOiJ2ZXJ0ZXg6cGFzc3dvcmRfcmVzZXQifQ.yqnUIm-HNXDt_jz6i2kaQbvX46zPCpn1dYOPitcw0T4"; // gitleaks:allow
const SETUP = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJnb2xkZW4tdXNlciIsInR5cGUiOiJhY2NvdW50X3NldHVwIiwiaWF0IjoxNzkyODAwMDAwLCJleHAiOjQxMDI0NDQ4MDAsImlzcyI6InZlcnRleC13ZWIiLCJhdWQiOiJ2ZXJ0ZXg6YWNjb3VudF9zZXR1cCJ9.SYfS1uVbKkTObvA6VgKrujokr68sUYLb_-CKi0oNq74"; // gitleaks:allow
// A referral agent's verification link (users step 8.4).
const AGENT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyZWZlcnJhbEFnZW50SWQiOiJjZ29sZGVuYWdlbnQwMDAxIiwidHlwZSI6InJlZmVycmFsX2FnZW50X2VtYWlsX3ZlcmlmaWNhdGlvbiIsImlhdCI6MTc5MjgwMDAwMCwiZXhwIjo0MTAyNDQ0ODAwLCJpc3MiOiJ2ZXJ0ZXgtd2ViIiwiYXVkIjoidmVydGV4OnJlZmVycmFsX2FnZW50X2VtYWlsX3ZlcmlmaWNhdGlvbiJ9.x44G1WfZUizqeCssbwcZjFHv51P_s9BDCTpDdpM3f1c"; // gitleaks:allow
// hash_password("Pass-word-1"): Python's bcrypt writes $2b$.
const FASTAPI_HASH = "$2b$12$NKXOpIvZEDJs3AuyJQVKQ.sSh/mvG2XtWeA/ElCYquPjOgXyQf/M2"; // gitleaks:allow

describe("links FastAPI signs pass the website's own checks", () => {
  it("verification, reset and setup", () => {
    expect(verifyEmailToken(VERIFICATION, "email_verification")).toMatchObject({ userId: "golden-user", email: "golden@test.invalid", type: "email_verification" });
    expect(verifyEmailToken(RESET, "password_reset")).toMatchObject({ userId: "golden-user", type: "password_reset" });
    expect(verifyAccountSetupToken(SETUP)).toMatchObject({ userId: "golden-user", type: "account_setup" });
    expect(verifyReferralAgentEmailVerificationToken(AGENT)).toMatchObject({ referralAgentId: "cgoldenagent0001", type: "referral_agent_email_verification" });
  });

  it("each only as its own kind", () => {
    expect(() => verifyEmailToken(RESET, "email_verification")).toThrow();
    expect(() => verifyEmailToken(VERIFICATION, "password_reset")).toThrow();
    expect(() => verifyReferralAgentEmailVerificationToken(VERIFICATION)).toThrow();
    expect(() => verifyEmailToken(AGENT, "email_verification")).toThrow();
  });
});

describe("passwords FastAPI hashes", () => {
  it("verify with bcryptjs", async () => {
    expect(await comparePassword("Pass-word-1", FASTAPI_HASH)).toBe(true);
    expect(await comparePassword("Pass-word-2", FASTAPI_HASH)).toBe(false);
  });
});
