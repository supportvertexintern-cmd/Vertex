"""money as exact decimals (upstream staging, 2026-11-13)

CasePayment.amount and ReferralCommission.amount were DOUBLE PRECISION: a
binary fraction, so 0.1 + 0.2 isn't 0.3 and sums of payments drift. They
become NUMERIC(12, 2), exact to the cent, as the partner commission tables
already are (migration 0023). Each stored value is rounded to the cent on
the way. The API still answers with plain numbers: every response types
these amounts as float.

Revision ID: 0024
Revises: 0023
Create Date: 2026-11-20
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0024"
down_revision: str | None = "0023"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = ("CasePayment", "ReferralCommission")


def upgrade() -> None:
    for table in TABLES:
        op.alter_column(
            table, "amount",
            existing_type=sa.Double(), type_=sa.Numeric(12, 2), existing_nullable=False,
            postgresql_using='round("amount"::numeric, 2)',
        )


def downgrade() -> None:
    for table in TABLES:
        op.alter_column(
            table, "amount",
            existing_type=sa.Numeric(12, 2), type_=sa.Double(), existing_nullable=False,
            postgresql_using='"amount"::double precision',
        )
