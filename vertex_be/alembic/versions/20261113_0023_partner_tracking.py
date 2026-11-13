"""partner tracking and commission management (Phase 6, 2026-11-01)

The virtual_assistant role; each partner's SLA, onboarding documents and the
team member looking after it; the partner commission and admin-fee ledgers
and the commission rules (USD 10 per registration, USD 40 a month after
deployment, until an admin changes them); and the partner reports and
follow-ups the team records. See app/models/partner_tracking.py.

Revision ID: 0023
Revises: 0022
Create Date: 2026-11-13
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0023"
down_revision: str | None = "0022"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ENUMS = {
    "SlaStatus": ("none", "sent", "signed"),
    "CommissionStatus": ("pending", "approved", "paid", "rejected"),
    "PartnerCommissionRuleType": ("registration", "monthly_deployment"),
    "AdminFeeType": ("application", "deployment_monthly"),
    "PartnerReportStatus": ("pending", "submitted", "returned", "closed"),
    "PartnerFollowUpStatus": ("open", "done"),
}


def enum(name: str) -> postgresql.ENUM:
    return postgresql.ENUM(*ENUMS[name], name=name, create_type=False)


def ts(name: str, nullable: bool = True) -> sa.Column:
    return sa.Column(name, postgresql.TIMESTAMP(precision=3), nullable=nullable)


def stamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", postgresql.TIMESTAMP(precision=3), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", postgresql.TIMESTAMP(precision=3), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        ts("deleted_at"),
        sa.Column("deleted_links", postgresql.JSONB(), nullable=True),
    ]


def user_fk(table: str, column: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint([column], ["User.id"], name=f"{table}_{column}_fkey", onupdate="CASCADE", ondelete="SET NULL")


def link_fk(table: str, column: str, target: str, ondelete: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint([column], [f"{target}.id"], name=f"{table}_{column}_fkey", onupdate="CASCADE", ondelete=ondelete)


def upgrade() -> None:
    # A new enum value can't be used in the transaction that adds it.
    with op.get_context().autocommit_block():
        op.execute("""ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'virtual_assistant'""")
    bind = op.get_bind()
    for name, values in ENUMS.items():
        postgresql.ENUM(*values, name=name).create(bind)

    op.add_column("Partner", sa.Column("sla_status", enum("SlaStatus"), server_default="none", nullable=False))
    op.add_column("Partner", ts("sla_signed_at"))
    op.add_column("Partner", sa.Column("onboarding_documents", postgresql.ARRAY(sa.Text()), server_default=sa.text("'{}'::text[]"), nullable=False))
    op.add_column("Partner", ts("documents_submitted_at"))
    op.add_column("Partner", sa.Column("assigned_team_member_id", sa.Text(), nullable=True))
    op.create_foreign_key(
        "Partner_assigned_team_member_id_fkey", "Partner", "User", ["assigned_team_member_id"], ["id"], onupdate="CASCADE", ondelete="SET NULL"
    )
    op.create_index("Partner_assigned_team_member_id_idx", "Partner", ["assigned_team_member_id"])

    op.create_table(
        "PartnerCommissionRule",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("rule_type", enum("PartnerCommissionRuleType"), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("currency", sa.Text(), server_default="USD", nullable=False),
        sa.Column("updated_by", sa.Text(), nullable=True),
        *stamps(),
        user_fk("PartnerCommissionRule", "updated_by"),
        sa.PrimaryKeyConstraint("id", name="PartnerCommissionRule_pkey"),
    )
    op.create_index("PartnerCommissionRule_rule_type_key", "PartnerCommissionRule", ["rule_type"], unique=True, postgresql_where=sa.text("deleted_at IS NULL"))

    op.create_table(
        "PartnerCommission",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("partner_id", sa.Text(), nullable=False),
        sa.Column("candidate_id", sa.Text(), nullable=False),
        sa.Column("case_id", sa.Text(), nullable=True),
        sa.Column("rule_type", enum("PartnerCommissionRuleType"), nullable=False),
        sa.Column("period", sa.Text(), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("currency", sa.Text(), server_default="USD", nullable=False),
        sa.Column("status", enum("CommissionStatus"), server_default="pending", nullable=False),
        sa.Column("approved_by", sa.Text(), nullable=True),
        ts("approved_at"),
        sa.Column("paid_by", sa.Text(), nullable=True),
        ts("paid_at"),
        sa.Column("payment_reference", sa.Text(), nullable=True),
        sa.Column("payment_method", sa.Text(), nullable=True),
        *stamps(),
        link_fk("PartnerCommission", "partner_id", "Partner", "CASCADE"),
        link_fk("PartnerCommission", "candidate_id", "Candidate", "CASCADE"),
        link_fk("PartnerCommission", "case_id", "Case", "SET NULL"),
        user_fk("PartnerCommission", "approved_by"),
        user_fk("PartnerCommission", "paid_by"),
        sa.PrimaryKeyConstraint("id", name="PartnerCommission_pkey"),
    )
    op.create_index("PartnerCommission_partner_id_idx", "PartnerCommission", ["partner_id"])
    op.create_index("PartnerCommission_candidate_id_idx", "PartnerCommission", ["candidate_id"])
    op.create_index("PartnerCommission_status_idx", "PartnerCommission", ["status"])
    op.create_index(
        "PartnerCommission_partner_id_candidate_id_rule_type_period_key", "PartnerCommission",
        ["partner_id", "candidate_id", "rule_type", "period"], unique=True, postgresql_where=sa.text("deleted_at IS NULL"),
    )

    op.create_table(
        "AdminFee",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("partner_id", sa.Text(), nullable=False),
        sa.Column("candidate_id", sa.Text(), nullable=False),
        sa.Column("case_id", sa.Text(), nullable=True),
        sa.Column("fee_type", enum("AdminFeeType"), nullable=False),
        sa.Column("period", sa.Text(), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("currency", sa.Text(), server_default="USD", nullable=False),
        sa.Column("status", enum("CommissionStatus"), server_default="pending", nullable=False),
        sa.Column("paid_by", sa.Text(), nullable=True),
        ts("paid_at"),
        sa.Column("payment_reference", sa.Text(), nullable=True),
        *stamps(),
        link_fk("AdminFee", "partner_id", "Partner", "CASCADE"),
        link_fk("AdminFee", "candidate_id", "Candidate", "CASCADE"),
        link_fk("AdminFee", "case_id", "Case", "SET NULL"),
        user_fk("AdminFee", "paid_by"),
        sa.PrimaryKeyConstraint("id", name="AdminFee_pkey"),
    )
    op.create_index("AdminFee_partner_id_idx", "AdminFee", ["partner_id"])
    op.create_index("AdminFee_candidate_id_idx", "AdminFee", ["candidate_id"])
    op.create_index("AdminFee_status_idx", "AdminFee", ["status"])
    op.create_index(
        "AdminFee_candidate_id_fee_type_period_key", "AdminFee", ["candidate_id", "fee_type", "period"],
        unique=True, postgresql_where=sa.text("deleted_at IS NULL"),
    )

    op.create_table(
        "PartnerReport",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("partner_id", sa.Text(), nullable=False),
        ts("reported_at", nullable=False),
        ts("period_start"),
        ts("period_end"),
        sa.Column("content", postgresql.JSONB(), nullable=False),
        sa.Column("status", enum("PartnerReportStatus"), server_default="pending", nullable=False),
        sa.Column("submitted_by", sa.Text(), nullable=True),
        *stamps(),
        link_fk("PartnerReport", "partner_id", "Partner", "CASCADE"),
        user_fk("PartnerReport", "submitted_by"),
        sa.PrimaryKeyConstraint("id", name="PartnerReport_pkey"),
    )
    op.create_index("PartnerReport_partner_id_idx", "PartnerReport", ["partner_id"])

    op.create_table(
        "PartnerFollowUp",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("partner_id", sa.Text(), nullable=False),
        sa.Column("action", sa.Text(), nullable=False),
        ts("due_at"),
        sa.Column("assigned_team_member", sa.Text(), nullable=True),
        sa.Column("status", enum("PartnerFollowUpStatus"), server_default="open", nullable=False),
        ts("completed_at"),
        *stamps(),
        link_fk("PartnerFollowUp", "partner_id", "Partner", "CASCADE"),
        user_fk("PartnerFollowUp", "assigned_team_member"),
        sa.PrimaryKeyConstraint("id", name="PartnerFollowUp_pkey"),
    )
    op.create_index("PartnerFollowUp_partner_id_idx", "PartnerFollowUp", ["partner_id"])
    op.create_index("PartnerFollowUp_assigned_team_member_idx", "PartnerFollowUp", ["assigned_team_member"])

    # The two rules, at the requirements' amounts.
    bind.execute(sa.text(
        """INSERT INTO "PartnerCommissionRule" (id, rule_type, amount, currency, updated_at) VALUES
           ('pcrule_registration', 'registration', 10.00, 'USD', CURRENT_TIMESTAMP),
           ('pcrule_monthly_deployment', 'monthly_deployment', 40.00, 'USD', CURRENT_TIMESTAMP)"""
    ))


def downgrade() -> None:
    for table in ("PartnerFollowUp", "PartnerReport", "AdminFee", "PartnerCommission", "PartnerCommissionRule"):
        op.drop_table(table)
    op.drop_index("Partner_assigned_team_member_id_idx", table_name="Partner")
    op.drop_constraint("Partner_assigned_team_member_id_fkey", "Partner", type_="foreignkey")
    for column in ("assigned_team_member_id", "documents_submitted_at", "onboarding_documents", "sla_signed_at", "sla_status"):
        op.drop_column("Partner", column)
    for name in ENUMS:
        postgresql.ENUM(name=name).drop(op.get_bind())
    # Postgres can't drop an enum value; virtual_assistant stays in "Role", unused.
