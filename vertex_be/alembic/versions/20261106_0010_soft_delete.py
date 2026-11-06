"""soft delete (owner's decision 2026-11-06, docs/architecture/soft-delete.md)

Every table but AuditLog and RefreshToken gets deleted_at and deleted_links, and
its unique rules apply to live rows only, under the same names. A downgrade is
refused while any row is soft deleted: it would lose the delete, and could break
the unique rules it puts back.

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-06
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP

from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = [
    'Application',
    'Campaign',
    'CampaignTarget',
    'Candidate',
    'CandidateMessage',
    'Case',
    'CasePayment',
    'CaseReminder',
    'CaseStageEvent',
    'ConsultationBooking',
    'Contract',
    'Country',
    'CountryDocumentRequirement',
    'Document',
    'DocumentRequirementType',
    'EmailTemplate',
    'EmployerClient',
    'ExceptionCorrectiveAction',
    'Exception',
    'FeePolicy',
    'InhouseCountryAssignment',
    'Job',
    'JobMilestonePrice',
    'JobPaymentStage',
    'JobPosition',
    'JobSector',
    'KnowledgeArticle',
    'Partner',
    'PartnerCandidate',
    'Payment',
    'RecruiterNote',
    'RecruiterTarget',
    'ReferralAgent',
    'ReferralAgentTarget',
    'ReferralCommission',
    'ReferralCommissionRule',
    'Region',
    'Report',
    'RetentionFollowUp',
    'Sector',
    'StaffKpiTarget',
    'StaffScorecard',
    'StaffScorecardArea',
    'SystemSetting',
    'User',
]

# Name, table, columns, and whether it was a constraint (else a unique index).
UNIQUES = [
    ('Candidate_user_id_key', 'Candidate', ['user_id'], True),
    ('Case_application_id_key', 'Case', ['application_id'], True),
    ('ConsultationBooking_stripe_checkout_session_id_key', 'ConsultationBooking', ['stripe_checkout_session_id'], True),
    ('Contract_case_id_key', 'Contract', ['case_id'], True),
    ('Country_name_key', 'Country', ['name'], True),
    ('CountryDocumentRequirement_country_id_document_type_key', 'CountryDocumentRequirement', ['country_id', 'document_type'], True),
    ('Exception_reference_key', 'Exception', ['reference'], True),
    ('InhouseCountryAssignment_unique', 'InhouseCountryAssignment', ['inhouse_supervisor_id', 'country_id'], True),
    ('JobMilestonePrice_job_id_type_key', 'JobMilestonePrice', ['job_id', 'type'], False),
    ('JobPaymentStage_job_id_order_key', 'JobPaymentStage', ['job_id', 'order'], True),
    ('JobSector_job_id_sector_key', 'JobSector', ['job_id', 'sector'], True),
    ('Partner_user_id_key', 'Partner', ['user_id'], True),
    ('PartnerCandidate_bridged_candidate_id_key', 'PartnerCandidate', ['bridged_candidate_id'], True),
    ('Payment_transaction_id_key', 'Payment', ['transaction_id'], True),
    ('RecruiterTarget_campaign_target_id_recruiter_id_key', 'RecruiterTarget', ['campaign_target_id', 'recruiter_id'], True),
    ('ReferralAgent_email_key', 'ReferralAgent', ['email'], True),
    ('ReferralAgent_referral_code_key', 'ReferralAgent', ['referral_code'], True),
    ('ReferralAgent_user_id_key', 'ReferralAgent', ['user_id'], True),
    ('ReferralCommission_candidate_id_milestone_key', 'ReferralCommission', ['candidate_id', 'milestone'], True),
    ('ReferralCommissionRule_country_id_milestone_key', 'ReferralCommissionRule', ['country_id', 'milestone'], True),
    ('Region_name_key', 'Region', ['name'], True),
    ('RetentionFollowUp_case_id_key', 'RetentionFollowUp', ['case_id'], True),
    ('Sector_name_key', 'Sector', ['name'], True),
    ('StaffKpiTarget_staff_id_cycle_kpi_label_key', 'StaffKpiTarget', ['staff_id', 'cycle', 'kpi_label'], True),
    ('StaffScorecard_staff_id_period_month_key', 'StaffScorecard', ['staff_id', 'period_month'], True),
    ('StaffScorecardArea_scorecard_id_area_key_key', 'StaffScorecardArea', ['scorecard_id', 'area_key'], True),
    ('User_email_key', 'User', ['email'], True),
    ('User_google_id_key', 'User', ['google_id'], True),
]


def upgrade() -> None:
    for table in TABLES:
        op.add_column(table, sa.Column("deleted_at", TIMESTAMP(precision=3), nullable=True))
        op.add_column(table, sa.Column("deleted_links", JSONB(), nullable=True))
    for name, table, columns, was_constraint in UNIQUES:
        if was_constraint:
            op.drop_constraint(name, table, type_="unique")
        else:
            op.drop_index(name, table_name=table)
        op.create_index(name, table, columns, unique=True, postgresql_where=sa.text("deleted_at IS NULL"))


def downgrade() -> None:
    connection = op.get_bind()
    for table in TABLES:
        deleted = connection.execute(sa.text(f'''SELECT count(*) FROM "{table}" WHERE deleted_at IS NOT NULL''')).scalar()
        if deleted:
            raise RuntimeError(f"{table} has {deleted} soft deleted row(s): restore or remove them first")
    for name, table, columns, was_constraint in UNIQUES:
        op.drop_index(name, table_name=table)
        if was_constraint:
            op.create_unique_constraint(name, table, columns)
        else:
            op.create_index(name, table, columns, unique=True)
    for table in TABLES:
        op.drop_column(table, "deleted_links")
        op.drop_column(table, "deleted_at")
