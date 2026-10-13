"""document malware-scan status

Every upload is scanned by ClamAV before it's stored (Phase 9). If the
scanner can't be reached the upload is still accepted but marked
"unscanned", and it's scanned when it's next opened. Existing documents
start as "unscanned" for the same reason.

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "Document",
        sa.Column("scan_status", sa.Text(), server_default="unscanned", nullable=False),
    )
    op.add_column("Document", sa.Column("scanned_at", postgresql.TIMESTAMP(precision=3), nullable=True))
    op.create_check_constraint(
        "Document_scan_status_check", "Document", "scan_status IN ('clean', 'unscanned', 'infected')"
    )


def downgrade() -> None:
    op.drop_constraint("Document_scan_status_check", "Document", type_="check")
    op.drop_column("Document", "scanned_at")
    op.drop_column("Document", "scan_status")
