# Session keys: ending the shared secret (E8)

Status: **approved by the owner, 2026-11-01: D1 to D5 all option A.** K1 next. Follows
[users-handover.md](users-handover.md), whose D1 A kept one shared key while
the area moved and registered exception E8 until "rotation to asymmetric
keys after 8.5". Steps 8.1 to 8.5 are done on `dev`.

## 1. Today

Every token is HS256, with a key per purpose derived from `JWT_SECRET` with
HKDF (G17). Both services hold `JWT_SECRET`:

| Purpose | Signed by | Checked by |
|---|---|---|
| `session` (15-minute access token) | FastAPI (`app/core/tokens.py`, since 8.2) | both: the website on every request (`lib/api-auth.ts`, `src/proxy.ts`), FastAPI in `app/core/auth.py` |
| `email_verification`, `password_reset`, `account_setup`, `referral_agent_email_verification` | FastAPI (since 8.3 and 8.4) | FastAPI only |
| `candidate_invite`, `cif_upload` | the website | FastAPI |
| `document` | the website | the website |
| `service` (the website's call to FastAPI) | the website | FastAPI; its own `SERVICE_AUTH_SECRET`, not `JWT_SECRET` |

**The risk (E8).** Anyone who controls the website can read `JWT_SECRET`, and
so derive the `session` key and mint a 15-minute access token for any user.
The per-request check (G19) still needs a live session, but the website can
read live session ids (`RefreshToken.family_id`).

**Found while planning (2026-11-01).** The same secret lets the website derive
the keys for **FastAPI's own account links**, though since 8.5 it has no use
for them:
- an `account_setup` link sets the first password of an account that has none
  (a staff, partner or referral agent login not yet claimed), so a forged one
  takes the account over;
- an `email_verification` or referral agent verification link marks an
  address verified.

A `password_reset` link is safer: it carries a fingerprint of the account's
current `password_hash`, which the website can no longer read (#8, step 8.5).
That holds only for accounts that have a password, so a reset link is as
open as a setup link for an account with none.

## 2. What changes

- **Sessions are signed with a private key that only FastAPI holds.** The
  website and FastAPI verify with the public key. The website can no longer
  mint a session, even with every secret it holds.
- **FastAPI's account links get a secret only FastAPI holds** (D4).
- **The website keeps `JWT_SECRET`** for the tokens it signs itself
  (`candidate_invite`, `cif_upload`, `document`), which FastAPI keeps
  checking with it.
- **The other moving parts change with it:**
  - `sessions-kill-switch.sh` still works: it ends sessions in the database.
  - The tools that mint a session token today do it inside the website's
    container with `JWT_SECRET` (`verify-stack.sh`'s G19 row, `zap/scan-staging.sh`,
    the tests' `lib/test-tokens.ts`). They move to the backend's container,
    or to a test-only key pair.

## 3. Decisions

Each one has a recommended option, as in the earlier handovers.

### D1. Which algorithm?

| Option | How | Cost |
|---|---|---|
| **A. ES256 (recommended)** | ECDSA on P-256. `jsonwebtoken` 9 (the website) and PyJWT with `cryptography` (FastAPI) already support it | No new library on either side. Keys and signatures are small |
| B. EdDSA (Ed25519) | The modern choice, with deterministic signatures | `jsonwebtoken` doesn't support it, so the website's verifier moves to `jose` |
| C. RS256 | RSA | Large keys and tokens; no gain over A |

### D2. Where do the keys live?

| Option | How | Cost |
|---|---|---|
| **A. The stack's env file (recommended)** | Base64 of the PEM, one line each. `SESSION_PRIVATE_KEY` goes to the backend only. `SESSION_PUBLIC_KEYS` goes to both. A script writes them into the env file without printing them (`deploy/session-keys.sh`) | Like every other secret today. The private key is in one service's environment only |
| B. Docker secrets (mounted files) | Files under `/run/secrets` | A second way of handling secrets, for one key |

### D3. How are they rotated?

| Option | How | Cost |
|---|---|---|
| **A. A key id and a list of public keys (recommended)** | Each token names its key (`kid`, the public key's thumbprint). Verifiers accept every key in `SESSION_PUBLIC_KEYS`. To rotate: add the new public key, deploy, switch the private key, deploy, then drop the old public key after 15 minutes | Rotation without anyone noticing |
| B. One key | Rotation is a swap | Every access token fails once, and refresh mends it; nobody is signed out, because refresh tokens are opaque database values |

### D4. FastAPI's account links

| Option | How | Cost |
|---|---|---|
| **A. A backend-only secret (recommended)** | `ACCOUNT_LINK_SECRET`, on the backend only, keys the four account-link purposes. During the switch FastAPI accepts links keyed either way, until those signed before it expire (setup links last 7 days), then only the new | Closes the forged setup link. One more secret to manage |
| B. Leave them on `JWT_SECRET` | Record it under E8 | The website could still take over an unclaimed account |

### D5. How does it switch?

| Option | How | Cost |
|---|---|---|
| **A. Three steps (recommended)** | K1: both sides accept the new forms as well as the old; nothing signs them yet. K2: FastAPI signs the new forms. K3: the old forms are refused and the website loses the `session` key | `deploy.sh` starts the backend minutes before the website. With K1 deployed first, a token from the new backend is never refused by the old website |
| B. One release | Accept both and sign new at once | For the minutes between the backend and the website starting, every signed-in request fails its check until the website catches up |

## 4. Steps

| Step | What | Needs |
|---|---|---|
| K1 | `deploy/session-keys.sh` writes a key pair (and, with D4 A, `ACCOUNT_LINK_SECRET`) into a stack's env file; `docker-compose.deploy.yml` passes them to each service. Both verifiers accept an ES256 session token from a listed key, as well as today's. FastAPI accepts account links keyed either way. Nothing signs the new forms yet | The owner runs the script for each stack (keys are never pasted into chat) |
| K2 | FastAPI signs sessions with the private key and account links with the new secret. `verify-stack.sh`, the ZAP scan and the tests mint with the new forms | K1 deployed on that stack |
| K3 | Refuse HS256 session tokens, and account links keyed from `JWT_SECRET`. The website drops the `session` key from `lib/jwt.ts`. Update the rotation runbook (`session-management.md` §5). Close E8 | K2 live on that stack for 7 days (the last setup link signed before it expired) |

Each PR has the usual checks:
- tests on both sides with a test-only key pair;
- golden vectors, so a token FastAPI signs passes the website's checks;
- a forged-token test, so a token signed with any key derived from
  `JWT_SECRET` is refused once K3 lands;
- the end-to-end journeys, which sign in on every run.

## 5. Risks

- **A lost or broken private key** fails every access token. Refresh can't
  mend that, because refresh signs with the same key. Mitigations:
  - `deploy.sh` refuses to start a backend whose private key doesn't match a
    listed public key;
  - the backend's health check signs and verifies once.
- **A leaked private key** is today's risk with `JWT_SECRET`, now confined to
  the backend. The runbook adds: rotate it as in D3, then run the kill
  switch.
- **Multi-line keys in env files** are easy to break. That's why D2 A uses
  one line of base64, checked at startup.

## 6. Exceptions

| Id | Change |
|---|---|
| E8 | Closed at K3, on each stack, main last. With D4 B instead, it stays open for the account links |

## 7. Progress

| Step | State |
|---|---|
| K1 | Done (#147): `app/core/session_keys.py` (key parsing, the key id, the startup check), `verify_session_token` and `lib/jwt.ts` `verifyToken` accept an ES256 session from a listed key as well as today's, each checked with its own algorithm only; account links verify keyed from `ACCOUNT_LINK_SECRET` or `JWT_SECRET`, a reset link's fingerprint under its own secret; `deploy/session-keys.sh`; the deploy file passes the keys (private key and link secret to the backend only). Nothing signs the new forms yet. Golden vector: an ES256 token FastAPI's code signed passes the website's check (`node_session_vectors.py`, `jwt.test.ts`). Rollback: revert; no migration, and stacks without keys behave as today |
| K2 | Done (#148): FastAPI signs sessions ES256 with `SESSION_PRIVATE_KEY` and keys new account links from `ACCOUNT_LINK_SECRET` (a reset link's fingerprint too) when the stack has them; a stack without them signs as before, so deploying K2 first breaks nothing. `verify-stack.sh`'s G19 row and the ZAP scan mint their tokens through FastAPI's signer in the backend container; the scan now gets a live session (its token had no session id since G19, so it hadn't been signing in). Before K2 takes effect on a stack: the owner runs `deploy/session-keys.sh` for its env file and redeploys. Rollback: revert, or remove the keys from the env file and redeploy; both forms stay accepted |
| K3 | Done (this PR). The 7-day wait (D5) was not needed on `dev`: its keys and K2 went live on 2026-11-01 on a database with no earlier activity (no audit rows, sessions or accounts waiting for a setup link), so no link or session in the old form existed. **Staging and main** get K3 with the next promotions: before each, the stack needs its keys (`session-keys.sh`) and either 7 days on K2 or the owner's OK to re-send setup links it sent in the old form. What K3 does: a session is ES256 from a listed key and nothing else; an account link is keyed from `ACCOUNT_LINK_SECRET` and nothing else; a deployed backend won't start without `SESSION_PRIVATE_KEY`, `SESSION_PUBLIC_KEYS` and `ACCOUNT_LINK_SECRET`; `lib/jwt.ts` has no `session` key any more. `session-keys.sh` rotates (`--stage`, `--promote`, `--retire`, `--new-link-secret`; runbook in `session-management.md` §5). `verify-stack.sh` proves E8 closed on a live session: the token the website could mint gets 401, the same session signed by FastAPI 200. Tests sign with a per-run test key pair (`tests/conftest.py`, `vertex/vitest.setup.ts`); CI's end-to-end job makes its keys with the script. Rollback: revert (K2's code accepts both forms again); no migration |
