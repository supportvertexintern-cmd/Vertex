"""Vectors produced by the Next.js signing code path itself (node:crypto
hkdfSync + jsonwebtoken, as vertex/src/lib/jwt.ts), with a TEST-ONLY secret
used nowhere else. They pin FastAPI's verifier to what Next.js really issues.

Regenerate with `node scripts/golden-session-vectors.mjs` from vertex/ if
jwt.ts's key derivation or claims ever change.
"""

SECRET = "test-only-jwt-secret-not-used-anywhere-0123456789"  # gitleaks:allow
SESSION_KEY_HEX = "54d718be7685ef75f2e288f165a486e80d2fd1cc169a2e302b41e69eefc5287f"  # gitleaks:allow
PASSWORD_RESET_KEY_HEX = "c1079b90f82017107c2c953a870776775b8ea87a410d7fd4b49cfd321e00605a"  # gitleaks:allow

# userId golden-user, email golden@test.invalid, role admin, sid golden-family,
# ver 3, issued 2026-10-23, expires 2100-01-01.
SESSION_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJnb2xkZW4tdXNlciIsImVtYWlsIjoiZ29sZGVuQHRlc3QuaW52YWxpZCIsInJvbGUiOiJhZG1pbiIsInNpZCI6ImdvbGRlbi1mYW1pbHkiLCJ2ZXIiOjMsImlhdCI6MTc5MjgwMDAwMCwiZXhwIjo0MTAyNDQ0ODAwLCJhdWQiOiJ2ZXJ0ZXg6c2Vzc2lvbiIsImlzcyI6InZlcnRleC13ZWIifQ.FbGuNBSOFjhN6oFHBz7bidWfddUeYHikcKmjwbHW-oE"  # gitleaks:allow

# The same claims, signed with the password_reset purpose's key: must never
# pass as a session (G17).
RESET_KEY_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJnb2xkZW4tdXNlciIsImVtYWlsIjoiZ29sZGVuQHRlc3QuaW52YWxpZCIsInJvbGUiOiJhZG1pbiIsInNpZCI6ImdvbGRlbi1mYW1pbHkiLCJ2ZXIiOjMsImlhdCI6MTc5MjgwMDAwMCwiZXhwIjo0MTAyNDQ0ODAwLCJhdWQiOiJ2ZXJ0ZXg6c2Vzc2lvbiIsImlzcyI6InZlcnRleC13ZWIifQ.sC8pN-K-qZ6kqyRu2yag-n9WTkjalto4o5eGwBlBeo8"  # gitleaks:allow

# A screening invite (signCandidateInviteToken) for candidate
# cgoldencandidate01, issued 2026-10-23, expires 2100-01-01.
INVITE_KEY_HEX = "fbfc30188eca687a2cbd8e2ad4cadf051f5a3ed1d07329880130423d33a5891e"  # gitleaks:allow
INVITE_CANDIDATE_ID = "cgoldencandidate01"
INVITE_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJjYW5kaWRhdGVJZCI6ImNnb2xkZW5jYW5kaWRhdGUwMSIsInR5cGUiOiJjYW5kaWRhdGVfaW52aXRlIiwiaWF0IjoxNzkyODAwMDAwLCJleHAiOjQxMDI0NDQ4MDAsImF1ZCI6InZlcnRleDpjYW5kaWRhdGVfaW52aXRlIiwiaXNzIjoidmVydGV4LXdlYiJ9.LXsKzdipECH-hdviypszg7FMt6L7iQbi2VcMv-CQ17Y"  # gitleaks:allow

# Email links as the website signed them before users step 8.3, for user
# golden-user (golden@test.invalid), issued 2026-10-23, expires 2100-01-01. A
# reset link from then carries no password fingerprint.
VERIFICATION_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJnb2xkZW4tdXNlciIsImVtYWlsIjoiZ29sZGVuQHRlc3QuaW52YWxpZCIsInR5cGUiOiJlbWFpbF92ZXJpZmljYXRpb24iLCJpYXQiOjE3OTI4MDAwMDAsImV4cCI6NDEwMjQ0NDgwMCwiYXVkIjoidmVydGV4OmVtYWlsX3ZlcmlmaWNhdGlvbiIsImlzcyI6InZlcnRleC13ZWIifQ.crHyOc_NXNooaIx5xfOiOaIcRHsyqRsTq9yq76BuDxs"  # gitleaks:allow
PASSWORD_RESET_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJnb2xkZW4tdXNlciIsImVtYWlsIjoiZ29sZGVuQHRlc3QuaW52YWxpZCIsInR5cGUiOiJwYXNzd29yZF9yZXNldCIsImlhdCI6MTc5MjgwMDAwMCwiZXhwIjo0MTAyNDQ0ODAwLCJhdWQiOiJ2ZXJ0ZXg6cGFzc3dvcmRfcmVzZXQiLCJpc3MiOiJ2ZXJ0ZXgtd2ViIn0.NJY4LxmZ4GRQZ8XWXVjSrIZBgHURIJXTlYPT8b9looM"  # gitleaks:allow
ACCOUNT_SETUP_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJnb2xkZW4tdXNlciIsInR5cGUiOiJhY2NvdW50X3NldHVwIiwiaWF0IjoxNzkyODAwMDAwLCJleHAiOjQxMDI0NDQ4MDAsImF1ZCI6InZlcnRleDphY2NvdW50X3NldHVwIiwiaXNzIjoidmVydGV4LXdlYiJ9.sgk-wkIF19iJT-_prgi1GIC9mUsdrIewMGWxmL28OD0"  # gitleaks:allow
