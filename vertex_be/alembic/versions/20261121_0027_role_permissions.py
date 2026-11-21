"""role management: the permissions the admin assigns to roles (2026-11-21)

One table (app/models/permissions.py), and the ticks that keep today's
behaviour: marketing edits and publishes the landing pages, as it could
before (admin holds every permission without a row).

Revision ID: 0027
Revises: 0026
Create Date: 2026-11-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0027"
down_revision: str | None = "0026"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "RolePermission",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("role", postgresql.ENUM(name="Role", create_type=False), nullable=False),
        sa.Column("permission", sa.Text(), nullable=False),
        sa.Column("granted_by", sa.Text(), nullable=True),
        sa.Column("created_at", postgresql.TIMESTAMP(precision=3), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("deleted_at", postgresql.TIMESTAMP(precision=3), nullable=True),
        sa.Column("deleted_links", postgresql.JSONB(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="RolePermission_pkey"),
        sa.ForeignKeyConstraint(
            ["granted_by"], ["User.id"], name="RolePermission_granted_by_fkey", onupdate="CASCADE", ondelete="SET NULL"
        ),
    )
    # One live tick per role and permission; an unticked (deleted) one can be ticked again.
    op.create_index(
        "RolePermission_role_permission_key", "RolePermission", ["role", "permission"], unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )  # fmt: skip
    op.execute(
        """INSERT INTO "RolePermission" (id, role, permission) VALUES
           ('roleperm_marketing_landing_edit', 'marketing', 'landing.edit'),
           ('roleperm_marketing_landing_publish', 'marketing', 'landing.publish')"""
    )


def downgrade() -> None:
    op.drop_table("RolePermission")
