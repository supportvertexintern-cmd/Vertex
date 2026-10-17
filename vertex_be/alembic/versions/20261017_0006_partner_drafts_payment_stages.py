"""partner drafts and stage-based payments (duncmv/vertex sync)

The Next.js app now carries the upstream work from duncmv/vertex (Aug 24 to
Oct 16), which needs two schema changes:

- PartnerCandidate draft audit: drafted_at, drafted_by and submitted_by
  (User, SET NULL). submitted_at becomes nullable with no default, because
  a draft has not been submitted yet.
- Payments are recorded against a JobPaymentStage again (as before 0004),
  and the app no longer sets CasePayment.type. type becomes nullable so new
  payments don't fail; job_payment_stage_id becomes NOT NULL, as the app's
  model requires. Payments recorded since 0004 without a stage are mapped
  back from their type through the case's job (the reverse of 0004's
  mapping); the migration stops if any can't be mapped to exactly one
  stage rather than guess.

Additive by the owner's rule: nothing is dropped. CasePayment.type,
Case.stage_deadline and JobMilestonePrice stay, unused by the app.

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TS = postgresql.TIMESTAMP(precision=3)


def upgrade() -> None:
    op.add_column("PartnerCandidate", sa.Column("drafted_at", TS, nullable=True))
    op.add_column("PartnerCandidate", sa.Column("drafted_by", sa.Text(), nullable=True))
    op.add_column("PartnerCandidate", sa.Column("submitted_by", sa.Text(), nullable=True))
    op.create_foreign_key(
        "PartnerCandidate_drafted_by_fkey", "PartnerCandidate", "User",
        ["drafted_by"], ["id"], ondelete="SET NULL", onupdate="CASCADE",
    )
    op.create_foreign_key(
        "PartnerCandidate_submitted_by_fkey", "PartnerCandidate", "User",
        ["submitted_by"], ["id"], ondelete="SET NULL", onupdate="CASCADE",
    )
    op.alter_column("PartnerCandidate", "submitted_at", nullable=True, server_default=None)

    op.execute(
        """
        UPDATE "CasePayment" p SET job_payment_stage_id = m.stage_id
        FROM (
            SELECT p2.id AS payment_id, min(s.id) AS stage_id
            FROM "CasePayment" p2
            JOIN "Case" c ON c.id = p2.case_id
            JOIN "Application" a ON a.id = c.application_id
            JOIN "JobPaymentStage" s ON s.job_id = a.job_id
             AND s.trigger_stage::text = CASE p2."type"::text
                   WHEN 'documentation' THEN 'registration_document_submission'
                   WHEN 'permit' THEN 'permit_authorization_approved'
                   WHEN 'visa' THEN 'visa_interview_decision'
                 END
            WHERE p2.job_payment_stage_id IS NULL
            GROUP BY p2.id
            HAVING count(*) = 1
        ) m
        WHERE p.id = m.payment_id
        """
    )
    op.execute(
        """
        DO $$
        DECLARE unmapped integer;
        BEGIN
          SELECT count(*) INTO unmapped FROM "CasePayment" WHERE job_payment_stage_id IS NULL;
          IF unmapped > 0 THEN
            RAISE EXCEPTION '% CasePayment rows have no single matching payment stage; map them before migrating', unmapped;
          END IF;
        END $$
        """
    )
    op.alter_column("CasePayment", "job_payment_stage_id", nullable=False)
    op.alter_column("CasePayment", "type", nullable=True)


def downgrade() -> None:
    op.execute('''DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM "CasePayment" WHERE "type" IS NULL) THEN
        RAISE EXCEPTION 'payments without a milestone type exist; downgrade would fail on NOT NULL';
      END IF;
      IF EXISTS (SELECT 1 FROM "PartnerCandidate" WHERE submitted_at IS NULL) THEN
        RAISE EXCEPTION 'unsubmitted drafts exist; downgrade would fail on NOT NULL';
      END IF; END $$''')
    op.alter_column("CasePayment", "type", nullable=False)
    op.alter_column("CasePayment", "job_payment_stage_id", nullable=True)
    op.alter_column(
        "PartnerCandidate", "submitted_at", nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")
    )
    op.drop_constraint("PartnerCandidate_submitted_by_fkey", "PartnerCandidate", type_="foreignkey")
    op.drop_constraint("PartnerCandidate_drafted_by_fkey", "PartnerCandidate", type_="foreignkey")
    op.drop_column("PartnerCandidate", "submitted_by")
    op.drop_column("PartnerCandidate", "drafted_by")
    op.drop_column("PartnerCandidate", "drafted_at")
