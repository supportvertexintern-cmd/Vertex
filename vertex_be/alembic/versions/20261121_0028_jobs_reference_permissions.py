"""role management: jobs and sectors & requirements become permissions (2026-11-21)

No schema change. Two permissions join the admin's Roles & Permissions page
(app/core/permissions.py): jobs.manage and reference.manage. They're ticked
for marketing, who had both by role, so nothing changes on deploy; admin
holds every permission without a row.

Revision ID: 0028
Revises: 0027
Create Date: 2026-11-21
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0028"
down_revision: str | None = "0027"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """INSERT INTO "RolePermission" (id, role, permission) VALUES
           ('roleperm_marketing_jobs_manage', 'marketing', 'jobs.manage'),
           ('roleperm_marketing_reference_manage', 'marketing', 'reference.manage')"""
    )


def downgrade() -> None:
    op.execute(
        """DELETE FROM "RolePermission" WHERE id IN ('roleperm_marketing_jobs_manage', 'roleperm_marketing_reference_manage')"""
    )
