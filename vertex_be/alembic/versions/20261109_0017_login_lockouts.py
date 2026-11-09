"""sign-in lockouts as rows (login protection, PR 1)

Until now a lockout was a counter in Redis: 10 failed sign-ins in 15
minutes held the address until the window ended, the same 15 minutes every
time, and nothing was left once it lifted. LoginLockout keeps each one: its
step (15 minutes, then 1 hour, 4 hours, 24 hours for lockouts in a row),
how long it holds, the failures and the last address, and how it ended
(expired, unlocked by an admin with a reason, or a password reset). Step 4
flags the account for review. Sign-in is refused while a row is open and
ahead of its locked_until.

Revision ID: 0017
Revises: 0016
Create Date: 2026-11-09
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0017"
down_revision: str | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ended_by = postgresql.ENUM("expired", "admin", "password_reset", name="LockoutEnd", create_type=False)


def upgrade() -> None:
    postgresql.ENUM("expired", "admin", "password_reset", name="LockoutEnd").create(op.get_bind())
    op.create_table(
        "LoginLockout",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("email_fp", sa.Text(), nullable=False),
        sa.Column("user_id", sa.Text(), nullable=True),
        sa.Column("step", sa.Integer(), nullable=False),
        sa.Column("locked_at", postgresql.TIMESTAMP(precision=3), nullable=False),
        sa.Column("locked_until", postgresql.TIMESTAMP(precision=3), nullable=False),
        sa.Column("failures", sa.Integer(), nullable=False),
        sa.Column("last_ip", sa.Text(), nullable=True),
        sa.Column("last_country", sa.Text(), nullable=True),
        sa.Column("notice_sent_at", postgresql.TIMESTAMP(precision=3), nullable=True),
        sa.Column("ended_at", postgresql.TIMESTAMP(precision=3), nullable=True),
        sa.Column("ended_by", ended_by, nullable=True),
        sa.Column("ended_by_user_id", sa.Text(), nullable=True),
        sa.Column("end_reason", sa.Text(), nullable=True),
        sa.Column("steps_reset_at", postgresql.TIMESTAMP(precision=3), nullable=True),
        sa.Column("needs_review", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("reviewed_at", postgresql.TIMESTAMP(precision=3), nullable=True),
        sa.Column("reviewed_by", sa.Text(), nullable=True),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["User.id"], name="LoginLockout_user_id_fkey", onupdate="CASCADE", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["ended_by_user_id"], ["User.id"], name="LoginLockout_ended_by_user_id_fkey", onupdate="CASCADE", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["reviewed_by"], ["User.id"], name="LoginLockout_reviewed_by_fkey", onupdate="CASCADE", ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id", name="LoginLockout_pkey"),
    )
    op.create_index("LoginLockout_email_fp_locked_at_idx", "LoginLockout", ["email_fp", "locked_at"])
    op.create_index("LoginLockout_user_id_idx", "LoginLockout", ["user_id"])
    op.create_index("LoginLockout_needs_review_idx", "LoginLockout", ["needs_review"], postgresql_where=sa.text("needs_review"))
    op.create_index("LoginLockout_one_open_idx", "LoginLockout", ["email_fp"], unique=True, postgresql_where=sa.text("ended_at IS NULL"))


def downgrade() -> None:
    op.drop_table("LoginLockout")
    postgresql.ENUM(name="LockoutEnd").drop(op.get_bind())
