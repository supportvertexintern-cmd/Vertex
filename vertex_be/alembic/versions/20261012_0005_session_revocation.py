"""session revocation (gap G19, exception E6)

Sessions used to be one 7-day JWT that nothing could revoke. Now:

- Access tokens live 15 minutes and carry the user's token_version and the
  session (refresh-token family) they belong to. Every request checks both
  against this database, so a revoked session or a bumped version stops
  access on the next request.
- RefreshToken stores refresh tokens server-side, as SHA-256 hashes only.
  Each refresh rotates the token (old row gets used_at, a new row joins the
  same family_id); presenting a used token again revokes the whole family.
- User.token_version is bumped by a trigger whenever password_hash or role
  changes, whatever code path makes the change, which ends every session
  of that user.

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TS = postgresql.TIMESTAMP(precision=3)


def upgrade() -> None:
    op.add_column("User", sa.Column("token_version", sa.Integer(), server_default="0", nullable=False))

    op.create_table(
        "RefreshToken",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("user_id", sa.Text(), nullable=False),
        sa.Column("family_id", sa.Text(), nullable=False),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column("token_version", sa.Integer(), nullable=False),
        sa.Column("device_info", sa.Text(), nullable=True),
        sa.Column("created_at", TS, server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("expires_at", TS, nullable=False),
        sa.Column("used_at", TS, nullable=True),
        sa.Column("revoked_at", TS, nullable=True),
        sa.Column("revoke_reason", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["User.id"], name="RefreshToken_user_id_fkey", onupdate="CASCADE", ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name="RefreshToken_pkey"),
        sa.UniqueConstraint("token_hash", name="RefreshToken_token_hash_key"),
    )
    op.create_index("RefreshToken_user_id_idx", "RefreshToken", ["user_id"])
    op.create_index("RefreshToken_family_id_idx", "RefreshToken", ["family_id"])

    op.execute(
        """
CREATE FUNCTION bump_user_token_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.password_hash IS DISTINCT FROM OLD.password_hash OR NEW.role IS DISTINCT FROM OLD.role THEN
    NEW.token_version := OLD.token_version + 1;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER user_token_version_bump BEFORE UPDATE ON "User"
  FOR EACH ROW EXECUTE FUNCTION bump_user_token_version();
"""
    )


def downgrade() -> None:
    op.execute('DROP TRIGGER IF EXISTS user_token_version_bump ON "User"')
    op.execute("DROP FUNCTION IF EXISTS bump_user_token_version()")
    op.drop_index("RefreshToken_family_id_idx", table_name="RefreshToken")
    op.drop_index("RefreshToken_user_id_idx", table_name="RefreshToken")
    op.drop_table("RefreshToken")
    op.drop_column("User", "token_version")
