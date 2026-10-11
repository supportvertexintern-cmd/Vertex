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

- **Run conditions.** Tasks run as the owner's account, only when logged on: the key is DPAPI-bound to that account, and Docker Desktop runs in that session. A run missed while the PC was off starts as soon as possible afterwards.
- **Logs** go to `D:\VertexData\backups\logs\`.
- **Freshness check.** `verify-stack.sh` fails if main's newest backup is more than 7 h old (staging: 8 days).

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
| Whole PC lost or disk failed | **Not recoverable today:** backups exist only on D: (accepted, §9). Once off-site copies exist: new host, Docker, repo, `.env.main` from the owner's records, the escrowed key (`backup-key.ps1` with the key re-imported), then step 3 |
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

Report `D:\VertexDataackups\drillsertex-main-20261011T132335Z.md`:

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

## 9. Open risks

| Risk | Status |
|---|---|
| Single disk: D: failure or loss of the PC loses the data and every backup | **Accepted by the owner for now.** `BACKUP_OFFSITE_CMD` is ready for an S3 bucket (`aws s3 sync`) |
| Key not yet escrowed | **Owner action** (§4) |
| Two old unencrypted dumps of real data in `D:\VertexData\backups\2026-10-10` and `\2026-10-11` | Access-restricted now. **Owner decision:** delete them, or keep `vertex_postgres_data` alone as the historical fallback |
| Tasks run only while the owner is logged on | Missed runs catch up at the next logon; the freshness check in `verify-stack.sh` flags gaps |
