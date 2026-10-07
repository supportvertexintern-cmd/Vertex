"""Every Postgres enum type, value-for-value.

Class names are the Postgres type names (see db.base.pg_enum), so renaming
a class here is a schema change, not a refactor.
"""

import enum


class Role(str, enum.Enum):
    candidate = "candidate"
    regional_recruiter = "regional_recruiter"
    country_supervisor = "country_supervisor"
    inhouse_supervisor = "inhouse_supervisor"
    director = "director"
    admin = "admin"
    # Posts/edits/closes job listings only — outside the 3-tier hierarchy.
    marketing = "marketing"
    # External agency login (SRS FR-5.1), admin-provisioned.
    partner = "partner"
    # Reviews partner submissions and creates the Case.
    hr = "hr"
    # Own case-stage movement, contracts, document handoff, reminders.
    operations_team = "operations_team"
    operations_director = "operations_director"
    # Milestone payment links/records and payments-due visibility.
    finance = "finance"
    # Self-registered, admin-approved external referrer.
    referral_agent = "referral_agent"


class ApplicationStatus(str, enum.Enum):
    submitted = "submitted"
    under_review = "under_review"
    interview = "interview"
    approved = "approved"
    rejected = "rejected"


class JobStatus(str, enum.Enum):
    active = "active"
    closed = "closed"
    draft = "draft"


class CandidateSource(str, enum.Enum):
    self_registered = "self_registered"
    recruiter_sourced = "recruiter_sourced"
    partner_sourced = "partner_sourced"
    referral_sourced = "referral_sourced"


class Gender(str, enum.Enum):
    male = "male"
    female = "female"


class CandidateLifecycleStatus(str, enum.Enum):
    identified = "identified"
    screened = "screened"
    guided_to_apply = "guided_to_apply"
    submitted = "submitted"
    reported = "reported"
    verified = "verified"
    approved = "approved"
    # Terminal side-branch, not a point on the linear track.
    rejected = "rejected"


class VerificationStatus(str, enum.Enum):
    pending = "pending"
    verified = "verified"
    rejected = "rejected"


class ReportCycle(str, enum.Enum):
    daily = "daily"
    weekly = "weekly"
    monthly = "monthly"


class ScopeLevel(str, enum.Enum):
    recruiter = "recruiter"
    country = "country"
    inhouse = "inhouse"


class ReportStatus(str, enum.Enum):
    draft = "draft"
    submitted = "submitted"
    verified = "verified"
    consolidated = "consolidated"
    returned = "returned"
    # Top-of-line (Management/Director reviewing an In-House report) vocabulary.
    approved = "approved"
    escalated = "escalated"
    closed = "closed"


class ExceptionCategory(str, enum.Enum):
    candidate_eligibility_screening = "candidate_eligibility_screening"
    documentation_data_integrity = "documentation_data_integrity"
    crm_system_issue = "crm_system_issue"
    target_capacity_performance = "target_capacity_performance"
    compliance_legal_ethical_risk = "compliance_legal_ethical_risk"
    candidate_welfare_conduct = "candidate_welfare_conduct"
    operational_timeline_dependency = "operational_timeline_dependency"
    other = "other"


class EscalationLevel(str, enum.Enum):
    regional = "regional"
    country = "country"
    inhouse = "inhouse"
    management = "management"


class ExceptionStatus(str, enum.Enum):
    open = "open"
    decided = "decided"
    closed = "closed"


class ExceptionDecision(str, enum.Enum):
    approved = "approved"
    modified = "modified"
    rejected = "rejected"
    escalated = "escalated"


class CorrectiveActionStatus(str, enum.Enum):
    open = "open"
    in_progress = "in_progress"
    done = "done"


class ScorecardStatus(str, enum.Enum):
    draft = "draft"
    finalized = "finalized"


class CampaignStatus(str, enum.Enum):
    draft = "draft"
    active = "active"
    closed = "closed"


class CampaignMetric(str, enum.Enum):
    verified_candidates = "verified_candidates"
    conversion_rate = "conversion_rate"


class ContactChannel(str, enum.Enum):
    email = "email"
    whatsapp = "whatsapp"
    phone = "phone"


class PaymentStatus(str, enum.Enum):
    pending = "pending"
    completed = "completed"
    failed = "failed"
    refunded = "refunded"


class CaseStage(str, enum.Enum):
    """The 11 Operational Workflow SOP §3 stages, in order."""

    registration_document_submission = "registration_document_submission"
    document_preparation_legalization = "document_preparation_legalization"
    permit_application_submission = "permit_application_submission"
    permit_processing_followup = "permit_processing_followup"
    permit_authorization_approved = "permit_authorization_approved"
    original_documents_dispatch = "original_documents_dispatch"
    partner_receives_permit = "partner_receives_permit"
    visa_interview_preparation = "visa_interview_preparation"
    visa_interview_decision = "visa_interview_decision"
    pre_departure_arrangements = "pre_departure_arrangements"
    departure_arrival_support = "departure_arrival_support"


class CaseOpsReviewStatus(str, enum.Enum):
    pending = "pending"
    confirmed = "confirmed"
    rejected = "rejected"


class CaseStatus(str, enum.Enum):
    active = "active"
    rejected = "rejected"


class CaseReminderChannel(str, enum.Enum):
    document = "document"
    payment = "payment"


class CasePaymentStatus(str, enum.Enum):
    pending = "pending"
    collected = "collected"


class ContractStatus(str, enum.Enum):
    draft = "draft"
    sent = "sent"
    signed = "signed"


class PartnerType(str, enum.Enum):
    travel_agency = "travel_agency"
    visa_consultancy = "visa_consultancy"
    manpower_supplier = "manpower_supplier"
    other = "other"


class PartnerStatus(str, enum.Enum):
    pending = "pending"
    active = "active"
    suspended = "suspended"


class MouStatus(str, enum.Enum):
    none = "none"
    sent = "sent"
    signed = "signed"


class PartnerCandidateStatus(str, enum.Enum):
    draft = "draft"
    submitted = "submitted"
    under_review = "under_review"
    job_assigned = "job_assigned"
    rejected = "rejected"


class EmployerClientStatus(str, enum.Enum):
    active = "active"
    inactive = "inactive"


class ReferralAgentStatus(str, enum.Enum):
    pending_approval = "pending_approval"
    active = "active"
    suspended = "suspended"
    rejected = "rejected"


class ReferralCommissionStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    paid = "paid"
    rejected = "rejected"


class ReferralMilestone(str, enum.Enum):
    registered = "registered"
    qualified = "qualified"
    application_submitted = "application_submitted"
    work_permit_approved = "work_permit_approved"
    visa_approved = "visa_approved"
    deployed = "deployed"
