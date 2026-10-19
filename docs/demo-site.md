# Customer demo site on Vercel

**Decided 2026-10-13 (owner).** Customers follow progress on a Vercel site
that updates automatically from `main`. It shows **demo data only**, from
its own free cloud database (Neon). It runs on Vercel's free Hobby plan
(the owner accepts its non-commercial terms).

## What it is

| | |
|---|---|
| App | The Next.js app, built by Vercel from `main` on every merge (`vertex/vercel.json`: other branches are skipped) |
| Database | Neon Postgres (free), schema from the Alembic migrations, like every stack. The site connects as `vertex_web`, never as the database owner |
| Data | Invented: `prisma/demo-seed.ts` (16 accounts, one per role, candidates at different stages, cases, payments, a partner). It refuses to run on a database with any real user |
| Accounts | Passwords in `D:\VertexData\demo\demo-accounts.txt` (outside Git). Give each customer only the accounts they need |
| Secrets | Fresh for the demo: new role passwords and a new `JWT_SECRET`. Nothing is copied from the local stacks |
| Not on the demo | Document uploads (no cloud bucket yet), malware scanning, email, Stripe/PayPal, the FastAPI backend (it serves no data yet) |

The demo is a separate system with separate data. It doesn't change
vertex-dev, vertex-staging or vertex-main.

## Setup (once)

**Owner:**

1. **Neon:** sign up at neon.tech (free), create a project in the EU (Frankfurt, near Vercel's `fra1`), and copy the **direct** connection string (Dashboard → Connect; turn *Connection pooling* off). It starts with `postgresql://`, names the user `neondb_owner` and a host ending in `.aws.neon.tech`, and ends with `sslmode=require`.
2. **Store it** on this PC (encrypted for your Windows account; it is never shown):
   ```powershell
   powershell -File vertex_be\deploy\demo\demo-creds.ps1 set owner
   ```
3. **Vercel:** sign in with the CLI and link the project:
   ```sh
   cd vertex
   npx vercel login
   npx vercel link
   ```
   In the Vercel dashboard, check that the project is connected to the GitHub repository (Settings → Git), with **Root Directory `vertex`** and **Production Branch `main`**.

**Agent** (from `vertex_be/`):

4. `bash deploy/demo/setup-demo-db.sh db`: roles, schema and demo data.
5. `DEMO_URL=https://<project>.vercel.app bash deploy/demo/setup-demo-db.sh vercel-env`: sets `DATABASE_URL` (as `vertex_web`), `JWT_SECRET`, `NEXT_PUBLIC_APP_URL`, `APP_ENV=demo` and `CSP_MODE` in Vercel, without printing them.
6. First deployment: merge to `main` (or `npx vercel --prod` once from `vertex/`), then sign in with a demo account and check the main pages.

## Every update after that

Merge to `main` → Vercel builds and publishes. Nothing else to do.

When a release adds a database migration, run step 4 again **before** merging to `main`. It applies the new migration and sets fresh role passwords. Then run step 5, so Vercel gets the new password.

## Security notes

- **Public site, invented data.** Anyone with the address can see the sign-in page. Only demo accounts exist.
- **No CI gate on Vercel.** Vercel builds whatever reaches `main`. With no branch protection on GitHub Free, the gate is the release process: only tested work is merged to `main`.
- **Search engines:** the demo isn't meant to be found. Don't publish the address.
- **Reset:** delete the Neon project and run steps 4 and 5 again for a clean demo.
