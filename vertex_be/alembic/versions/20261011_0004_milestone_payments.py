"""milestone payments: schema the Next.js app expects

Found by the Phase 8 DAST scan (2026-10-11): the Next.js code (Prisma
schema) and the deployed database had drifted. The app's milestone-payment
model (JobMilestonePrice, CasePayment.type, Case.stage_deadline) was never
in the database, so case, payment and job endpoints failed with 500s.

Additive only, by the owner's decision: nothing is dropped, so the
database's job-position, payment-stage and referral tables and columns stay
as they are.

- MilestonePaymentType enum and the JobMilestonePrice table, as Prisma
  defines them.
- Case.stage_deadline (nullable).
- CasePayment.type, backfilled from the payment's stage:
      registration_document_submission -> documentation
      permit_authorization_approved    -> permit
      visa_interview_decision          -> visa
  The migration stops if any payment can't be mapped rather than guess.
- CasePayment.job_payment_stage_id becomes nullable: the app doesn't set
  it, so every new payment would otherwise fail.

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

milestone = postgresql.ENUM("documentation", "permit", "visa", name="MilestonePaymentType", create_type=False)


def upgrade() -> None:
    postgresql.ENUM("documentation", "permit", "visa", name="MilestonePaymentType").create(op.get_bind())

    op.create_table(
        "JobMilestonePrice",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("job_id", sa.Text(), nullable=False),
        sa.Column("type", milestone, nullable=False),
        sa.Column("amount_gbp", sa.Double(), nullable=False),
        sa.Column("stripe_product_id", sa.Text(), nullable=False),
        sa.Column("stripe_price_id", sa.Text(), nullable=False),
        sa.Column("created_at", postgresql.TIMESTAMP(precision=3), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", postgresql.TIMESTAMP(precision=3), nullable=False),
        sa.ForeignKeyConstraint(["job_id"], ["Job.id"], name="JobMilestonePrice_job_id_fkey", onupdate="CASCADE", ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name="JobMilestonePrice_pkey"),
    )
    op.create_index("JobMilestonePrice_job_id_type_key", "JobMilestonePrice", ["job_id", "type"], unique=True)

    op.add_column("Case", sa.Column("stage_deadline", postgresql.TIMESTAMP(precision=3), nullable=True))

    op.add_column("CasePayment", sa.Column("type", milestone, nullable=True))
    op.execute(
        """
        UPDATE "CasePayment" p SET "type" = CASE s.trigger_stage::text
            WHEN 'registration_document_submission' THEN 'documentation'
            WHEN 'permit_authorization_approved' THEN 'permit'
            WHEN 'visa_interview_decision' THEN 'visa'
          END::"MilestonePaymentType"
        FROM "JobPaymentStage" s
        WHERE s.id = p.job_payment_stage_id
        """
    )
    op.execute(
        """
        DO $$
        DECLARE unmapped integer;
        BEGIN
          SELECT count(*) INTO unmapped FROM "CasePayment" WHERE "type" IS NULL;
          IF unmapped > 0 THEN
            RAISE EXCEPTION '% CasePayment rows have a stage with no milestone type; map them before migrating', unmapped;
          END IF;
        END $$
        """
    )
    op.alter_column("CasePayment", "type", nullable=False)
    op.alter_column("CasePayment", "job_payment_stage_id", nullable=True)


def downgrade() -> None:
    op.execute('''DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM "CasePayment" WHERE job_payment_stage_id IS NULL) THEN
        RAISE EXCEPTION 'payments created without a stage exist; downgrade would fail on NOT NULL';
      END IF; END $$''')
    op.alter_column("CasePayment", "job_payment_stage_id", nullable=False)
    op.drop_column("CasePayment", "type")
    op.drop_column("Case", "stage_deadline")
    op.drop_index("JobMilestonePrice_job_id_type_key", table_name="JobMilestonePrice")
    op.drop_table("JobMilestonePrice")
    postgresql.ENUM(name="MilestonePaymentType").drop(op.get_bind())
