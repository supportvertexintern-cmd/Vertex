"""passport numbers normalised (2026-11-12)

Stored passport numbers lose all whitespace and are upper-cased, the same
rule as app.core.passport.normalize_passport, which every write now applies.
The partner duplicate check compares them exactly, so a pasted trailing space
used to let one person through as several candidates.

Only rows whose value changes are touched; one that would become empty is left
as it is. Nothing is merged or deleted: people who now share a number are
listed in the log (ids only) for a human to look at.

Revision ID: 0022
Revises: 0021
Create Date: 2026-11-13
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0022"
down_revision: str | None = "0021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# [[:space:]] and the non-breaking space, which the locale may not count.
NORMALIZED = """upper(regexp_replace("passport_number", '[[:space:]\\u00a0]', '', 'g'))"""
TABLES = ("Candidate", "PartnerCandidate")


def normalize(bind) -> dict[str, tuple[int, int]]:
    """Per table: (rows normalised, numbers shared by more than one row)."""
    out = {}
    for table in TABLES:
        changed = bind.execute(
            sa.text(
                f'UPDATE "{table}" SET "passport_number" = {NORMALIZED} '
                f'WHERE "passport_number" IS NOT NULL AND "passport_number" <> {NORMALIZED} AND {NORMALIZED} <> \'\''
            )
        ).rowcount
        shared = bind.execute(
            sa.text(
                f'SELECT count(*) FROM (SELECT 1 FROM "{table}" WHERE "passport_number" IS NOT NULL '
                f'GROUP BY "passport_number" HAVING count(*) > 1) d'
            )
        ).scalar()
        out[table] = (changed, shared)
    return out


def upgrade() -> None:
    for table, (changed, shared) in normalize(op.get_bind()).items():
        print(f"0022: {table}: {changed} passport number(s) normalised; {shared} number(s) shared by more than one row")


def downgrade() -> None:
    # The original whitespace isn't kept anywhere, and it was never meaningful.
    pass
