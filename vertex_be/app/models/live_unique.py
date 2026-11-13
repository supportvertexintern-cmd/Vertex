"""The unique rules, for live rows only (soft delete, owner's decision
2026-11-06): a deleted user's email or a deleted country's name is free again.
They keep their names. DocumentRequirementType.key isn't here: foreign keys
point at it, and a partial index can't back a foreign key, so a deleted type's
key stays taken."""

from sqlalchemy import Index

from app.db.base import Base

LIVE_UNIQUE = {
    "Candidate_user_id_key": ("Candidate", ('user_id',)),
    "Case_application_id_key": ("Case", ('application_id',)),
    "ConsultationBooking_stripe_checkout_session_id_key": ("ConsultationBooking", ('stripe_checkout_session_id',)),
    "Contract_case_id_key": ("Contract", ('case_id',)),
    "Country_name_key": ("Country", ('name',)),
    "CountryDocumentRequirement_country_id_document_type_key": ("CountryDocumentRequirement", ('country_id', 'document_type')),
    "Exception_reference_key": ("Exception", ('reference',)),
    "InhouseCountryAssignment_unique": ("InhouseCountryAssignment", ('inhouse_supervisor_id', 'country_id')),
    "JobMilestonePrice_job_id_type_key": ("JobMilestonePrice", ('job_id', 'type')),
    "JobPaymentStage_job_id_order_key": ("JobPaymentStage", ('job_id', 'order')),
    "JobSector_job_id_sector_key": ("JobSector", ('job_id', 'sector')),
    "Partner_user_id_key": ("Partner", ('user_id',)),
    "PartnerCandidate_bridged_candidate_id_key": ("PartnerCandidate", ('bridged_candidate_id',)),
    "PartnerCommission_partner_id_candidate_id_rule_type_period_key": ("PartnerCommission", ('partner_id', 'candidate_id', 'rule_type', 'period')),
    "PartnerCommissionRule_rule_type_key": ("PartnerCommissionRule", ('rule_type',)),
    "AdminFee_candidate_id_fee_type_period_key": ("AdminFee", ('candidate_id', 'fee_type', 'period')),
    "Payment_transaction_id_key": ("Payment", ('transaction_id',)),
    "RecruiterTarget_campaign_target_id_recruiter_id_key": ("RecruiterTarget", ('campaign_target_id', 'recruiter_id')),
    "ReferralAgent_email_key": ("ReferralAgent", ('email',)),
    "ReferralAgent_referral_code_key": ("ReferralAgent", ('referral_code',)),
    "ReferralAgent_user_id_key": ("ReferralAgent", ('user_id',)),
    "ReferralCommission_candidate_id_milestone_key": ("ReferralCommission", ('candidate_id', 'milestone')),
    "ReferralCommissionRule_country_id_milestone_key": ("ReferralCommissionRule", ('country_id', 'milestone')),
    "Region_name_key": ("Region", ('name',)),
    "RetentionFollowUp_case_id_key": ("RetentionFollowUp", ('case_id',)),
    "Sector_name_key": ("Sector", ('name',)),
    "StaffKpiTarget_staff_id_cycle_kpi_label_key": ("StaffKpiTarget", ('staff_id', 'cycle', 'kpi_label')),
    "StaffScorecard_staff_id_period_month_key": ("StaffScorecard", ('staff_id', 'period_month')),
    "StaffScorecardArea_scorecard_id_area_key_key": ("StaffScorecardArea", ('scorecard_id', 'area_key')),
    "User_email_key": ("User", ('email',)),
    "User_google_id_key": ("User", ('google_id',)),
}

for name, (table_name, columns) in LIVE_UNIQUE.items():
    table = Base.metadata.tables[table_name]
    Index(name, *(table.c[c] for c in columns), unique=True, postgresql_where=table.c.deleted_at.is_(None))
