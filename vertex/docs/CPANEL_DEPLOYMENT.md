# Deploying to cPanel

cPanel Node hosting is the real production target for this app (matches
SRS §2.3 and `output: 'standalone'` in `next.config.ts`). Vercel was only
ever an interim deployment used for earlier redesign work — this is the
process for updating the actual cPanel app.

## 1. Build and package locally

From the project root:

```bash
node build-cpanel.mjs
```

This script (already in the repo root):

- Runs `npm run build`.
- Copies `public/` into `.next/standalone/public`.
- Copies `.next/static` into `.next/standalone/public/_next/static` — a
  deliberate trick: cPanel's Passenger automatically serves anything
  under `public/`, so placing the compiled CSS/JS there lets Passenger
  serve it directly instead of routing every asset request through Node.
- Renames `.next/standalone/server.js` → `app.js` and patches its PORT
  parsing (`parseInt(process.env.PORT, 10) || 3000` → `process.env.PORT
  || 3000`) — Passenger sometimes hands the app a Unix socket path via
  `PORT` rather than a numeric port, and `parseInt` on a socket path
  silently falls back to `3000`, which is what caused a 503 in an earlier
  deploy attempt.

Then trim the bundle down to what actually needs to leave your machine —
dev-only files and a file with a leaked database credential
(`probe.js`, unrelated legacy script, not used by the app) shouldn't be
uploaded:

```bash
cd .next/standalone
rm -rf probe.js e2e playwright.config.ts vitest.config.ts vitest.setup.ts tsconfig.tsbuildinfo build-cpanel.mjs
cd ../..
```

Zip it up, **excluding `.env`** (see step 3 for why):

```bash
cd .next
zip -r -q vertex-cpanel-deploy.zip standalone -x "standalone/.env"
```

You'll have `.next/vertex-cpanel-deploy.zip`, ready to upload.

## 2. Update the existing cPanel app

1. **cPanel → Software → "Setup Node.js App"** → open the existing Vertex
   app → **Stop App** (avoids the running process locking files you're
   about to overwrite).
2. **File Manager**: navigate to the app's root folder and rename it
   (e.g. `app` → `app-backup-YYYY-MM-DD`) rather than deleting it, so you
   can roll back if something goes wrong.
3. **Upload** `vertex-cpanel-deploy.zip` into that location, then
   **Extract** it. This creates a `standalone/` folder — move its
   *contents* (not the folder itself) up so `app.js` sits directly at the
   app root, matching where the previous deploy had it.

## 3. Set environment variables

The zip deliberately excludes `.env` — a real DB password, JWT secret,
and SMTP password shouldn't sit in a downloadable archive. Two ways to
get them onto the server, pick one:

- **Recommended**: cPanel → "Setup Node.js App" → your app →
  **Environment Variables** section → add each key/value pair directly
  through the UI. Never touches disk as a file.
- **Alternative**: File Manager → inside the app root → "+ File" → name
  it `.env` → Edit → paste in the production values (ask for these
  again if you need them re-sent — they include live credentials that
  shouldn't be pasted into just any channel).

Either way, the required variables are:

`DATABASE_URL`, `NEXT_PUBLIC_APP_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`,
`EMAIL_TOKEN_EXPIRES_IN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GOOGLE_GENERATIVE_AI_API_KEY`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`,
`SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`, `PUBLIC_FORMS_NOTIFY_EMAIL`,
`PARTNER_SUBMISSION_NOTIFY_EMAIL`, `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`,
`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_API_BASE`,
`UPLOAD_DIR`, `MAX_FILE_SIZE_MB`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `RATE_LIMIT_WINDOW_MS`,
`RATE_LIMIT_MAX_REQUESTS`.

**Important — Google OAuth**: add
`https://vertexintern.com/api/auth/google/callback` to this OAuth
client's Authorized Redirect URIs in Google Cloud Console, or Google
login will fail with `redirect_uri_mismatch`.

## 4. Restart and verify

1. Back in "Setup Node.js App": confirm the Application Startup File is
   `app.js`, click **Run NPM Install** if prompted (should be a no-op —
   `node_modules` is already bundled in the zip), then **Restart App**.
2. Visit `https://vertexintern.com` and confirm it loads with styles/CSS
   intact (the Passenger static-serving trick working).
3. Log in with the admin account to confirm the database connection
   works end-to-end.

## One-time database setup (only if pointing at a freshly created schema)

If the `DATABASE_URL` is brand new (never had `prisma db push` run
against it), do this from your local machine before the app will work:

```bash
DATABASE_URL="<production-url>" npx prisma db push
DATABASE_URL="<production-url>" npm run db:seed
psql "<production-url>" -f prisma/audit-log-immutability.sql
```

The last step is required and easy to miss — `prisma db push` doesn't
apply raw SQL, so the audit-log immutability trigger (blocks
UPDATE/DELETE on `AuditLog` at the database level) has to be run
separately on every freshly created schema.

## Resolved: leaked database credential in `probe.js`

`probe.js` (repo root) contained a hardcoded, plaintext Supabase database
password. Resolved 2026-10-08: the credential was rotated, `probe.js` was
deleted, and git history was rewritten to remove it (verified with a
full-history gitleaks scan of the GitHub repository). The Supabase project
was never the production database. The process for any future leak is in
`docs/secrets.md` at the monorepo root.
