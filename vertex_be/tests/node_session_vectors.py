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

# A referral agent's verification link as the website signed it before users
# step 8.4, for agent cgoldenagent0001, issued 2026-10-23, expires 2100-01-01.
REFERRAL_AGENT_ID = "cgoldenagent0001"
REFERRAL_AGENT_VERIFICATION_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyZWZlcnJhbEFnZW50SWQiOiJjZ29sZGVuYWdlbnQwMDAxIiwidHlwZSI6InJlZmVycmFsX2FnZW50X2VtYWlsX3ZlcmlmaWNhdGlvbiIsImlhdCI6MTc5MjgwMDAwMCwiZXhwIjo0MTAyNDQ0ODAwLCJhdWQiOiJ2ZXJ0ZXg6cmVmZXJyYWxfYWdlbnRfZW1haWxfdmVyaWZpY2F0aW9uIiwiaXNzIjoidmVydGV4LXdlYiJ9.lUP17hrCv-bDgWsPbr6_4hszZ1BHbhlvnk4tLTMdQLg"  # gitleaks:allow

# Session keys K1 (docs/architecture/session-keys-handover.md): an ES256
# session token as FastAPI signs one from K2, with a TEST-ONLY key pair whose
# private half was thrown away. The website's jwt.test.ts checks the same
# token against the same public key. Issued 2026-10-23, expires 2100-01-01.
SESSION_PUBLIC_KEY_B64 = "LS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS0KTUZrd0V3WUhLb1pJemowQ0FRWUlLb1pJemowREFRY0RRZ0FFSUN4VFdUQy9yWDVvcnZ3TjkvZXBHd055TG05KwpwVE1ZUndRcUlUQllvZUJVbUl1SjhGYkNxTTZwNXQwNzlxUG85eXRtNkxjbllXTTVIZmhIYzZ0b2VnPT0KLS0tLS1FTkQgUFVCTElDIEtFWS0tLS0tCg=="  # gitleaks:allow
SESSION_KEY_ID = "JeGP3Eqajqgr3GMK"
ES256_SESSION_TOKEN = "eyJhbGciOiJFUzI1NiIsImtpZCI6IkplR1AzRXFhanFncjNHTUsiLCJ0eXAiOiJKV1QifQ.eyJ1c2VySWQiOiJnb2xkZW4tdXNlciIsImVtYWlsIjoiZ29sZGVuQHRlc3QuaW52YWxpZCIsInJvbGUiOiJhZG1pbiIsInNpZCI6ImdvbGRlbi1mYW1pbHkiLCJ2ZXIiOjMsImlhdCI6MTc5MjgwMDAwMCwiZXhwIjo0MTAyNDQ0ODAwLCJpc3MiOiJ2ZXJ0ZXgtd2ViIiwiYXVkIjoidmVydGV4OnNlc3Npb24ifQ.EPmmlByMPIdLFjDUHam1Ry-q2c0Jyl1s5ypNJucABVVepkeuRI414sXqGu6hstDJqLZlptpR_x3obzh3lmwloQ"  # gitleaks:allow
