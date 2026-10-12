# Backup and disaster recovery

Phase 11. Recorded 2026-10-11. The tools are in `vertex_be/deploy/backup/`. The owner's decisions (2026-10-11):

- **What and how often:** vertex-main every 6 hours, staging weekly, dev not backed up.
- **Where:** D: only for now, with a cloud copy later.
- **Encryption:** AES-256 with a DPAPI-protected key.

## 1. What data lives where

Each stack is separate: its own Compose project, networks, database volume and object-store folder. Nothing is shared between dev, staging and main.

| Data | dev | staging | main | Backed up |
|---|---|---|---|---|
| PostgreSQL (all application data, audit trail) | volume `vertex-dev_postgres_data` (78 MB) | `vertex-staging_postgres_data` (65 MB) | `vertex-main_postgres_data` (67 MB) | main 6-hourly, staging weekly |
| Documents (MinIO bucket `vertex-<env>`) | `D:\VertexData\minio\dev` | `…\staging` | `…\main` | with the database, same schedule |
| `<stack>_uploads` volume | 4 KB, unused | unused | unused | no (empty; documents live in MinIO since Phase 9) |
| pgAdmin settings | `vertex-dev_pgadmin_data` | (none) | (none) | no (rebuilt from config) |
| Secrets (`vertex_be/.env.<env>`), backup key | on this PC only | | | **never in a backup** (§8) |

- Docker's volumes live in its WSL disk on D: (`D:\Docker\wsl\data`).
- Three legacy volumes from before the stack split are attached to nothing: `vertex_postgres_data` (77 MB, the original data that main was restored from), `vertex_pgadmin_data` and `vertex_vertex_postgres_data`. They are kept as a fallback until the owner decides to delete them.
- Two older, **unencrypted** hand-made dumps from the migration days sit in `D:\VertexData\backups\2026-10-10` and `\2026-10-11` (§9).

## 2. Schedule

`install-schedule.ps1` registers these Windows scheduled tasks under `\Vertex\`:

| Task | When | What |
|---|---|---|
| Backup vertex-main | every 6 h (00, 06, 12, 18) | `backup.sh vertex-main` |
| Backup vertex-staging | Sundays 03:30 | `backup.sh vertex-staging` |
| Restore drill vertex-main | every 4 weeks, Sunday 04:00 | `restore-drill.sh vertex-main` |
| Backup health check (E5) | every hour | `backup-health.sh`: alerts if main's newest backup is over 7 h old (staging: 8 days), the newest off-site copy is over 26 h old, or the newest drill is over 35 days old |
| Off-site prune (E5) | Saturdays 04:30, once off-site is configured | `offsite.py prune … --apply` (admin credential) |
| Off-site restore drill vertex-main (E5) | every 4 weeks, Saturday 05:00, once off-site is configured | `offsite-drill.sh`: downloads the newest off-site copy and runs the full restore drill on it |

- **Run conditions.** Tasks run as the owner's account, only when logged on: the key is DPAPI-bound to that account, and Docker Desktop runs in that session. A run missed while the PC was off starts as soon as possible afterwards.
- **Logs** go to `D:\VertexData\backups\logs\`.
- **Freshness check.** `verify-stack.sh` fails if main's newest backup is more than 7 h old (staging: 8 days).
- **Alerts (E5).** A failed backup (`backup.sh` ERR trap), a failed off-site copy and every health-check finding raise an alert through `alert.sh`. The alert is:
  - a line in `logs/alerts.log`;
  - an `alert_raised` row in the stack's audit trail;
  - an email to `SECURITY_ALERT_EMAILS` (default: every admin), sent through the stack's own mail settings.

  The same rule repeats at most once every 6 h. Delivery to Mailpit and the stale-backup alert were tested on 2026-10-12.

## 3. What a backup is

`D:\VertexData\backups\<project>\<UTC stamp>\`:

| File | Content |
|---|---|
| `db.dump.gpg` | `pg_dump -Fc` of the stack's database |
| `documents.tar.gpg` | every object in the stack's bucket |
| `manifest.json` | project and time, schema version, Postgres version, backend image; **exact row count per table**; document count, bytes and tree hash; SHA-256 of each file, plaintext and encrypted. No data, no credentials |

- **No plaintext on disk.** Both data files stream from the containers straight into `gpg --symmetric --cipher-algo AES256` (authenticated, SHA-512 key derivation). No unencrypted copy is ever written.
- **Consistent counts.** Row counts are taken before and after the dump. Equal counts mean the manifest describes exactly what was dumped (`counts_consistent`).
- **Not in a dump:** database roles and their passwords, which are cluster-wide. On restore they're recreated from the env file by `db-roles.sql`.

## 4. Protection and access

- **Key.** `backup-key.ps1` creates a random 256-bit key, stored only as a DPAPI blob (`D:\VertexData\backup-keys\`) that only the owner's Windows account on this PC can unwrap. Scripts receive it through a file descriptor, never on a command line or in a plaintext file.
- **Folder access.** `D:\VertexData\backups` and `D:\VertexData\backup-keys`: inheritance removed; only the owner's account, SYSTEM and Administrators. Checked on every file. `D:\VertexData\security-scans` is locked the same way.
- **gpg isolation.** Each run uses a throwaway gpg home, never the owner's keyring.
- **⚠ Owner action: key escrow.** Run `powershell -File vertex_be\deploy\backup\backup-key.ps1 escrow` once and store the value in a password manager. A Windows reinstall, a new PC or a lost profile can't unwrap the DPAPI blob, and without the key no backup can be read.

## 5. Retention and cleanup

`prune.py` runs after every backup:

| Stack | Kept |
|---|---|
| main | every backup from the last 48 h; then the newest per day for 14 days, per ISO week for 8 weeks, per month for 12 months |
| staging | the newest 4 |

- **Incomplete runs.** A directory without a manifest (an interrupted run) is deleted after a day.
- **Last backup protected.** The newest complete backup is never deleted, however old, because if backups stop it's the only restore point.
- **Size.** At about 0.3 MB per main backup today, a year of retention is about 15 MB.
- Unit-tested in `tests/test_backup_retention.py`.

## 6. Recovery procedure

**Recovery objectives:**

| | Target | Basis |
|---|---|---|
| **RPO** (data that can be lost) | main **6 h**; staging 7 days; dev: rebuild | the schedule |
| **RTO** (time to working service) | main **1 h** | measured restore: 44 s on staging (§7); the rest is margin for diagnosis, Docker start-up and the post-restore checks |

**Restoring a stack** (`restore.sh`, tested on staging, §7):

1. Pick the backup:
   ```sh
   ls D:/VertexData/backups/vertex-main/
   ```
   The newest is usually right. For corruption or a bad change, pick the last one before it.
2. Prove it restores, without touching the stack:
   ```sh
   bash deploy/backup/restore-drill.sh vertex-main D:/VertexData/backups/vertex-main/<stamp>
   ```
3. Restore (from `vertex_be/`):
   ```sh
   bash deploy/backup/restore.sh vertex-main D:/VertexData/backups/vertex-main/<stamp> --yes-replace-vertex-main
   ```
   The script does the following:
   1. Verifies the checksums.
   2. Stops Next.js and the backend.
   3. Takes a **safety backup** of the current state.
   4. Recreates the database and restores into it, decrypting in a pipe; checks the row counts against the manifest.
   5. Re-provisions roles and ownership (`db-roles.sql`).
   6. Replaces the bucket's documents.
   7. Starts the backend, which migrates the restored data to the current schema, and then Next.js.
4. Check:
   ```sh
   bash deploy/verify-stack.sh main
   ```
   Then sign in and open a case.
5. Record what happened, and from which backup, in the incident notes.

**Other scenarios:**

| Scenario | Recovery |
|---|---|
| Lost or corrupted database volume | as above |
| Bad release | roll back the images (release checklist); restore only if data was changed |
| Whole PC lost or disk failed | **Not recoverable until the off-site bucket exists** (E5: built and rehearsed, §9; waiting for the owner's bucket and keys). Then: fetch the newest off-site copy (`offsite.py fetch`), and on the new host: new host, Docker, repo, `.env.main` from the owner's records, the escrowed key (`backup-key.ps1` with the key re-imported), then step 3 |
| Lost backup key | Existing backups are unreadable without the escrowed copy. Create a new key (`init`) and take a fresh backup at once |

## 7. Tests run on 2026-10-11

**Restore drill** (`restore-drill.sh`, disposable Postgres on an internal network, removed afterwards):

| Run | Result |
|---|---|
| main backup `20261011T125546Z` with dev images `7c6b90a` | Every integrity, document and secrets check passed: 1,256 rows in 46 tables restored exactly; migrated 0001 → 0004; `alembic check` clean. Two red rows: the drill's own migration ran as `postgres` (drill bug: fixed to run as `vertex_migrator`, like a deploy), and Prisma couldn't read 5 `PartnerCandidate` drafts on main (real defect: fixed in `885a5c9`) |
| main backup `20261011T130240Z` (taken by the scheduled task) with dev images `f215633` | **PASSED**, 24 s (§7.1) |

**Real restore on staging** (`restore.sh`, backup `20261011T103439Z`):

- Safety backup taken first.
- A marker row added after the backup was gone afterwards, and row counts equalled the manifest (59).
- The stack was healthy again in **44 s**.
- `verify-stack.sh staging` passed all 42 Phase 2–9 checks, including every database-permission check.

### 7.1 Final drill: PASSED

Report `D:/VertexData/backups/drills/vertex-main-20261011T132335Z.md`:

| Check | Result |
|---|---|
| Backup files, encrypted and decrypted checksums | match |
| `pg_restore` | ok |
| Rows per table vs manifest | identical: 1,256 rows, 46 tables |
| Constraints validated, audit-trail triggers | 0 unvalidated, 2 triggers |
| Roles (`db-roles.sql`) | provisioned |
| Backend `f215633`: migrate to head as `vertex_migrator`, health as `vertex_api` | 0001 → 0004, healthy |
| `alembic check` | no drift |
| Next.js `f215633`: Prisma reads every row of every model as `vertex_web` | all 39 models |
| Documents: tree hash, database references present, unexpected files | match, 0 missing, 0 unexpected (main's bucket is empty today) |
| Env-file secrets, credential patterns (dump and manifest) | 0, none |
| Elapsed | 24 s |

## 8. Secrets and unnecessary files

Every drill checks the following and reports counts only, never a value:

- **Backup contents.** The backup holds exactly `db.dump.gpg`, `documents.tar.gpg` and `manifest.json`: no env files, keys or logs.
- **Env-file secrets.** No value from the stack's env file appears in the dump or the manifest. 0 found (every key named like `SECRET`, `PASSWORD`, `_KEY`, `TOKEN` or `PASS` was checked).
- **Credential shapes.** No private keys, AWS or Stripe secret keys, credentialed connection strings or JWTs in the dump. None found.
- **Document archive.** Only server-generated names (`<type>/<uuid>.<pdf|jpg|png>`), so nothing else can have been copied in.
- **Password hashes.** Present (10 on main) by design: users must be able to sign in after a restore. They are bcrypt hashes and stay encrypted inside the backup.

## 9. Off-site copy (E5, 3-2-1)

**Goal.** Three copies on two kinds of storage, one of them off-site and immutable:
- the live database;
- the encrypted copy on D:;
- an off-site object-storage bucket with Object Lock.

**How it works.**
- **Encrypted before it leaves.** The backups are encrypted on this PC before they leave (gpg AES-256, §3), so the provider only ever stores ciphertext. The key stays here, plus the escrow copy.
- **Pushed after every backup.** After each backup, `backup.sh` runs `offsite.py push`. It uploads `db.dump.gpg`, `documents.tar.gpg` and then `manifest.json`; the manifest goes last because it marks a complete copy. Each file has a SHA-256 checksum that the provider verifies. The AWS CLI runs in a pinned container (`amazon/aws-cli:2.27.0`). Credentials reach it through the environment, never on a command line.
- **Immutable.** The bucket has versioning and Object Lock, with a default retention of 30 days in COMPLIANCE mode. No one can delete or overwrite a copy before its retention ends: not the writer key, not the admin key, and not ransomware on this PC.
- **Two credentials,** stored like the backup key (DPAPI, `offsite-creds.ps1`):

  | Credential | Used by | May |
  |---|---|---|
  | writer | every backup | `s3:PutObject` only: no list, read or delete |
  | admin | weekly prune, monthly off-site drill | list, read, delete (deletes fail while a copy is locked) |

- **Retention off-site:** 7 daily, 4 weekly, 6 monthly (`prune.py` policy `offsite`). Copies past the policy are deleted once their lock expires. Backups contain candidates' personal data, so check this against the data-retention policy for candidate data. A candidate erased from the database stays in off-site copies for up to about 6 months.
- **Restore tests:**
  - **Monthly, automatic:** `offsite-drill.sh` downloads the newest copy and runs the full restore drill on it.
  - **Quarterly, by hand:** a timed drill against the 1 h RTO with `restore.sh` on staging (§6), using an off-site copy fetched with `offsite.py fetch`.

### 9.1 Setting it up (owner)

1. **Choose a provider.** Use a different account from anything else on this PC. Examples:
   - **AWS S3:** create the bucket with *Object Lock* enabled (this also turns on versioning). Default retention: COMPLIANCE, 30 days.
   - **Backblaze B2:** create the bucket with *Object Lock* enabled. Default retention: Compliance, 30 days. Use the S3 endpoint, e.g. `https://s3.eu-central-003.backblazeb2.com`.
   - Any other S3-compatible store with Object Lock in compliance mode.
2. **Create the writer key,** allowed only `s3:PutObject` on `arn:aws:s3:::<bucket>/*`. On B2: an application key restricted to the bucket, with only the `writeFiles` capability.
3. **Create the admin key,** allowed `s3:ListBucket`, `s3:ListBucketVersions`, `s3:GetObject`, `s3:GetObjectVersion`, `s3:DeleteObject`, `s3:DeleteObjectVersion` and `s3:GetObjectRetention` on the bucket and its objects. Never `s3:BypassGovernanceRetention`, and no permission to change the bucket's lock settings. Also keep this key in the password manager.
4. **Store both keys** on this PC (each prompts):
   ```powershell
   powershell -File vertex_be\deploy\backup\offsite-creds.ps1 set writer
   powershell -File vertex_be\deploy\backup\offsite-creds.ps1 set admin
   ```
5. **Write `D:\VertexData\backup-keys\offsite.conf`.** It holds no secrets:
   ```
   OFFSITE_BUCKET=<bucket>
   OFFSITE_ENDPOINT=            # empty for AWS; B2/Wasabi: their S3 endpoint
   OFFSITE_REGION=<region>
   ```
6. **Check, push and prove.** From `vertex_be/`:
   ```sh
   python deploy/backup/offsite.py check-writer      # put allowed; list, get, delete denied
   bash deploy/backup/backup.sh vertex-main .env.main # now also pushes off-site
   bash deploy/backup/offsite-drill.sh vertex-main    # restore test of the off-site copy
   powershell -File deploy\backup\install-schedule.ps1   # adds the weekly prune and monthly off-site drill
   ```

The first successful `offsite-drill.sh` against the real bucket is the evidence that closes E5. Record it in §7.

### 9.2 Rehearsal, 2026-10-12 (local stand-in for the provider)

This used a throwaway S3-compatible bucket (MinIO), configured like the real one: versioning on, Object Lock COMPLIANCE 30 days, a writer key with PutObject only and an admin key. The test data was the newest staging backup.

| Check | Result |
|---|---|
| `check-writer` | put allowed; list, get, delete **denied** ✅ |
| `push` | 3 files uploaded with SHA-256 checksums; state recorded for the health check ✅ |
| Writer deletes a copy | **denied** ✅ |
| Admin deletes a locked version | **refused**: "Object is WORM protected" ✅ |
| Object retention | COMPLIANCE until 2026-11-11 (30 days) ✅ |
| `prune --apply` | policy applied; the newest copy kept ✅ |
| `fetch latest` + full restore drill of the downloaded copy | **PASSED in 24 s**: checksums, all rows, migrated to head, no model drift, all 39 Prisma models, no secrets ✅ |
| Alerts | test alert emailed (Mailpit) and audited; a stale-backup (275 h) alert and an "off-site never pushed" alert fired from `backup-health.sh` ✅ |

## 10. Open risks

| Risk | Status |
|---|---|
| Single disk: D: failure or loss of the PC loses the data and every backup | **Exception E5, being closed.** The off-site copy is built and rehearsed (§9). It needs the owner's bucket and keys (§9.1) and the first real off-site restore |
| Key not yet escrowed | **Owner action** (§4). Without the escrowed key, an off-site copy can't be read after losing this PC |
| ~~Two old unencrypted dumps of real data~~ | **Closed 2026-10-12.** The pre-migration originals are kept, encrypted, in `legacy\pre-migration-dumps-20261010.tar.gpg` (decryption verified); the plaintext was deleted |
| Tasks run only while the owner is logged on | Missed runs catch up at the next logon. The hourly health check alerts on gaps |
