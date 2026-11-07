"""security alerts as rows (admin monitoring, phase 2)

Until now an alert was a log line, an alert_raised row on the audit trail
and an email. SecurityAlert keeps each one as a row admins can list and
review on Admin -> Monitoring -> Suspicious Activity: open, then reviewing,
then resolved or dismissed, with a note. The monitor writes the row with the
trail's; the review is an audited change (who, when, the note).

The alerts already on the trail are copied in, as open: vertex_api can't
read the trail, so this is the only way they reach the page. The account an
alert is about is the one its detail names (user_id or actor_id), when that
account still exists.

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-07
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

severity = postgresql.ENUM("critical", "high", "medium", name="SecurityAlertSeverity", create_type=False)
status = postgresql.ENUM("open", "reviewing", "resolved", "dismissed", name="SecurityAlertStatus", create_type=False)

# The trail's alerts: entity_id is the dedupe key, after the redacted detail
# with its severity, rule and summary.
BACKFILL = """
        INSERT INTO "SecurityAlert" (id, rule, alert_key, severity, summary, user_id, ip, detail, status, created_at)
        SELECT
            'ca' || substr(md5(a.id), 1, 23),
            coalesce(a.after ->> 'rule', split_part(a.entity_id, ':', 1)),
            a.entity_id,
            CASE WHEN a.after ->> 'severity' IN ('critical', 'high', 'medium') THEN a.after ->> 'severity' ELSE 'high' END::"SecurityAlertSeverity",
            coalesce(a.after ->> 'summary', 'Security alert'),
            (SELECT u.id FROM "User" u WHERE u.id = coalesce(a.after ->> 'user_id', a.after ->> 'actor_id')),
            coalesce(a.after ->> 'ip', a.after ->> 'last_ip'),
            a.after,
            'open',
            a.created_at
        FROM "AuditLog" a
        WHERE a.action = 'alert_raised' AND a.entity_type = 'SecurityAlert'
        """


def upgrade() -> None:
    postgresql.ENUM("critical", "high", "medium", name="SecurityAlertSeverity").create(op.get_bind())
    postgresql.ENUM("open", "reviewing", "resolved", "dismissed", name="SecurityAlertStatus").create(op.get_bind())
    op.create_table(
        "SecurityAlert",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("rule", sa.Text(), nullable=False),
        sa.Column("alert_key", sa.Text(), nullable=False),
        sa.Column("severity", severity, nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("user_id", sa.Text(), nullable=True),
        sa.Column("ip", sa.Text(), nullable=True),
        sa.Column("detail", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("status", status, server_default="open", nullable=False),
        sa.Column("reviewed_by", sa.Text(), nullable=True),
        sa.Column("reviewed_at", postgresql.TIMESTAMP(precision=3), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", postgresql.TIMESTAMP(precision=3), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["User.id"], name="SecurityAlert_user_id_fkey", onupdate="CASCADE", ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["reviewed_by"], ["User.id"], name="SecurityAlert_reviewed_by_fkey", onupdate="CASCADE", ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id", name="SecurityAlert_pkey"),
    )
    op.create_index("SecurityAlert_status_created_at_idx", "SecurityAlert", ["status", "created_at"])
    op.create_index("SecurityAlert_user_id_idx", "SecurityAlert", ["user_id"])
    op.create_index("SecurityAlert_rule_idx", "SecurityAlert", ["rule"])
    op.create_index("SecurityAlert_created_at_idx", "SecurityAlert", ["created_at"])
    op.execute(BACKFILL)


def downgrade() -> None:
    op.drop_table("SecurityAlert")
    postgresql.ENUM(name="SecurityAlertStatus").drop(op.get_bind())
    postgresql.ENUM(name="SecurityAlertSeverity").drop(op.get_bind())
