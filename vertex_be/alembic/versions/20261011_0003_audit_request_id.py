"""audit log request correlation

Phase 10: each audit row records the ID of the request that produced it
(the X-Request-ID both services log), so an audited change or security
event can be followed back to the application logs. The (action,
created_at) index serves the security monitor's recent-event counts
(failed logins, denials, alerts).

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("AuditLog", sa.Column("request_id", sa.Text(), nullable=True))
    op.create_index("AuditLog_request_id_idx", "AuditLog", ["request_id"])
    op.create_index("AuditLog_action_created_at_idx", "AuditLog", ["action", "created_at"])


def downgrade() -> None:
    op.drop_index("AuditLog_action_created_at_idx", table_name="AuditLog")
    op.drop_index("AuditLog_request_id_idx", table_name="AuditLog")
    op.drop_column("AuditLog", "request_id")
