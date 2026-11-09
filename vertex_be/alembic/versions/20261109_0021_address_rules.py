"""address controls (login protection, PR 5)

AddressRule holds an admin's block or allow on a network address or range.
A block refuses sign-in, registration and password-reset requests from it
(the website checks it, 403) until it expires, at most 30 days; an allow
exempts it from the website's per-address limits, never from the
per-account lockout. Rows are never deleted: removing one sets removed_at,
by whom and why.

Revision ID: 0021
Revises: 0020
Create Date: 2026-11-09
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0021"
down_revision: str | None = "0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

kind = postgresql.ENUM("block", "allow", name="AddressRuleKind", create_type=False)


def upgrade() -> None:
    postgresql.ENUM("block", "allow", name="AddressRuleKind").create(op.get_bind())
    op.create_table(
        "AddressRule",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("network", postgresql.CIDR(), nullable=False),
        sa.Column("kind", kind, nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("created_by", sa.Text(), nullable=True),
        sa.Column("created_at", postgresql.TIMESTAMP(precision=3), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("expires_at", postgresql.TIMESTAMP(precision=3), nullable=True),
        sa.Column("removed_at", postgresql.TIMESTAMP(precision=3), nullable=True),
        sa.Column("removed_by", sa.Text(), nullable=True),
        sa.Column("removed_reason", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["created_by"], ["User.id"], name="AddressRule_created_by_fkey", onupdate="CASCADE", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["removed_by"], ["User.id"], name="AddressRule_removed_by_fkey", onupdate="CASCADE", ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id", name="AddressRule_pkey"),
    )
    op.create_index("AddressRule_active_idx", "AddressRule", ["kind"], postgresql_where=sa.text("removed_at IS NULL"))


def downgrade() -> None:
    op.drop_table("AddressRule")
    postgresql.ENUM(name="AddressRuleKind").drop(op.get_bind())
