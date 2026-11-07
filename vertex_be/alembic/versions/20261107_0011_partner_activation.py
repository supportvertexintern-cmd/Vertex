"""partner login activation and first-time welcome (owner's requirement 2026-11-07)

User.activated_at: when a partner's login first signs in; the account is
active from then on. User.welcomed_at: when the partner portal first showed
the welcome, so it shows once. Both stay as they are through password resets.

Partners who have signed in before this migration count as activated and
welcomed, at their first recorded sign-in, so the welcome is only for new ones.

Revision ID: 0011
Revises: 0010
Create Date: 2026-11-07
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import TIMESTAMP

from alembic import op

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# A successful sign-in is recorded as login_succeeded on entity "user:<id>".
BACKFILL = """
        UPDATE "User" u
        SET activated_at = f.first_at, welcomed_at = f.first_at
        FROM (
            SELECT substr(entity_id, 6) AS user_id, min(created_at) AS first_at
            FROM "AuditLog"
            WHERE action = 'login_succeeded' AND entity_id LIKE 'user:%'
            GROUP BY 1
        ) f
        WHERE u.id = f.user_id AND u.role = 'partner'
        """


def upgrade() -> None:
    op.add_column("User", sa.Column("activated_at", TIMESTAMP(precision=3), nullable=True))
    op.add_column("User", sa.Column("welcomed_at", TIMESTAMP(precision=3), nullable=True))
    op.execute(BACKFILL)


def downgrade() -> None:
    op.drop_column("User", "welcomed_at")
    op.drop_column("User", "activated_at")
