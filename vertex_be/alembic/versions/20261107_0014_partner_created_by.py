"""who added each partner agency (admin monitoring, phase 3)

Partner.created_by: the staff member who added the agency, from now on, and
for existing agencies from the audit trail's create row where it names
someone who still has an account. Admin -> Monitoring -> Partners & Logins
shows it, with when and by whom each partner's login was created
(User.created_at and created_by, migration 0012).

Revision ID: 0014
Revises: 0013
Create Date: 2026-11-07
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CREATED_BY = """
        UPDATE "Partner" p
        SET created_by = a.actor_id
        FROM "AuditLog" a
        WHERE a.entity_type = 'Partner' AND a.action = 'create' AND a.entity_id = p.id
          AND a.actor_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM "User" x WHERE x.id = a.actor_id)
        """


def upgrade() -> None:
    op.add_column("Partner", sa.Column("created_by", sa.Text(), nullable=True))
    op.create_foreign_key("Partner_created_by_fkey", "Partner", "User", ["created_by"], ["id"], ondelete="SET NULL", onupdate="CASCADE")
    op.create_index("Partner_created_by_idx", "Partner", ["created_by"])
    op.execute(CREATED_BY)


def downgrade() -> None:
    op.drop_index("Partner_created_by_idx", table_name="Partner")
    op.drop_constraint("Partner_created_by_fkey", "Partner", type_="foreignkey")
    op.drop_column("Partner", "created_by")
