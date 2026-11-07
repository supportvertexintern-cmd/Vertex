# Soft delete

**Owner's decision, 2026-11-06:** delete is soft delete everywhere. Nothing a user deletes leaves the database or object storage.

The code is `vertex_be/app/db/soft_delete.py`. Routes keep calling `db.delete()`, and one set of hooks turns that into setting `deleted_at`, so no route or query can forget.

## Owner's choices

| Question | Decision |
|---|---|
| How is something brought back? | An admin restore API: list deleted records, restore one with everything deleted with it. No website screen yet. |
| Are unique values freed? | Yes. A deleted user's email or a deleted country's name can be used again. Restoring is refused if the value has since been taken. |
| Is anything ever erased? | No, for now. Deleted records and their files are kept indefinitely. |

**This last choice has a known consequence.** Deleted personal data, including passports and other stored files, stays on disk with no time limit and no way to erase it through the app. If a privacy law, contract or erasure request needs it gone, a retention rule or an admin purge has to be added first. The owner should check this with whoever handles compliance.

**Owner's decision, 2026-11-07:** deleted personal data must not stay indefinitely, in the database or in backups, and the retention period waits for legal. Before an erase job is built, legal also has to answer this: the audit trail (`AuditLog`) holds a full copy of every deleted row, in the delete's `before` snapshot and in earlier updates. It's append-only, and database triggers refuse any change to it. Erasing only the rows and their files would leave those copies. So the decision needs to cover both:

1. how long a deleted record and its files are kept before they're erased, and
2. whether the audit trail's copies of an erased record must be blanked too, keeping who did what and when. That would mean a narrow, audited exception to its append-only rule.

Backups then age the erased data out: dev keeps its newest 4, and the off-site policy keeps up to 6 months (docs/security/backup-recovery.md §5, §9).

## What happens on a delete

| Foreign key rule | Before | Now |
|---|---|---|
| `CASCADE` | Postgres removed the children | They're soft deleted too, with the same `deleted_at` |
| `SET NULL` | Postgres cleared the link | The link is cleared, and saved on the deleted row in `deleted_links` for a restore |
| `RESTRICT` | Postgres refused | A live child refuses it with the same `IntegrityError` (23503), so each route's 409 still works |

`SET NULL` links are cleared rather than kept, so behaviour stays as it was. A deleted recruiter's candidates must still show up as unassigned, for example.

- **Reading:** every ORM `SELECT` leaves out deleted rows, wherever the table appears: joins, subqueries, relationships, counts. Only `.execution_options(include_deleted=True)` shows them.
- **Audit trail:** a soft delete is recorded as `delete`, with the row before it. The `SET NULL` changes are recorded as updates, which Postgres's own never were.
- **Files:** stored files are kept, including the old file when an upload replaces one. The only file removed is that of an upload that failed to save.
- **Safety net:** a real `DELETE` of a protected row raises `HardDeleteRefused`, so a path these hooks miss fails loudly instead of destroying data. Bulk deletes on audited tables were already refused.

## Restoring

Admin only, audited as `restore`. There's no website screen yet.

| Route | What it does |
|---|---|
| `GET /api/admin/deleted?table=&limit=` | The most recently deleted records, newest first, of one table or all (up to 200) |
| `POST /api/admin/deleted/{table}/{id}/restore` | Brings the record back |

FastAPI's own routes are `/api/v1/deleted` and `/api/v1/deleted/{table}/{id}/restore`.

- **What comes back:** the record and what its delete cascaded to, matched by the same `deleted_at`. Something deleted earlier, on its own, stays deleted.
- **Links:** those its delete cleared are put back only where still empty, so a candidate reassigned since stays with its new recruiter.
- **Refused with a 409:**
  - `needs_restore_first`: a record it needs is still deleted. The message names it.
  - `unique_taken`: a live record now has the same email, name or other unique value.
  - `replaced`: a newer document of the same type has replaced this one.
- **Sessions:** they don't come back. A restored user signs in again.

## Exceptions

| What | Why |
|---|---|
| `AuditLog` | Already append-only. |
| `RefreshToken` | Its rows are credentials. A deleted user's sessions really end, and a restored user signs in again. |
| `DocumentRequirementType.key` | Foreign keys point at it, and a partial index can't back a foreign key. A deleted type's key stays taken, so it can't be re-created under the same key; restore it instead. |
| Seeds and e2e fixtures | `purge()` goes straight to the connection to clear local test data. Never used by the app. |

## What sees deleted rows

| Where | Deleted rows? |
|---|---|
| API responses | No, and the two new columns are never in a response. The existing routes' schemas are unchanged. |
| Backup export (`app/services/backup.py`) | No. It reads tables directly, so it filters for itself. |
| Encrypted backups (`pg_dump`) | Yes. They hold the whole database. |
| pgAdmin (`vertex_readonly`) | Yes. `deleted_at` is readable and `deleted_links` isn't, so a query must filter on `deleted_at` itself. |

## Writing new code

- Call `db.delete(row)`. Don't remove a row from a `delete-orphan` collection: it raises `HardDeleteRefused`.
- A new table gets `SoftDeletable`, and each column needs a row in `deploy/readonly-columns.sql`. Tests fail otherwise.
- A new unique rule goes in `app/models/live_unique.py`, not `unique=True`.
- SQL that bypasses the ORM doesn't get the filter, so it must filter on `deleted_at` itself.

## Rollback

Revert the code and run `alembic downgrade 0009`. The downgrade refuses while any row is soft deleted, because it would lose the delete and could break the unique rules it puts back.
