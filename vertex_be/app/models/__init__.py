"""Importing this package registers every model on Base.metadata (needed
by Alembic and by string-based relationship resolution)."""

from app.models.audit import AuditLog
from app.models.campaign import Campaign, CampaignTarget, RecruiterTarget
from app.models.candidate import Application, Candidate, CandidateMessage, Document
from app.models.cases import (
    Case,
    CasePayment,
    CaseReminder,
    CaseStageEvent,
    Contract,
    FeePolicy,
    RetentionFollowUp,
)
from app.models.identity import Country, InhouseCountryAssignment, Region, User
from app.models.jobs import EmployerClient, Job, JobMilestonePrice, JobPaymentStage, JobPosition, JobSector
from app.models.partners import Partner, PartnerCandidate
from app.models.payments import ConsultationBooking, Payment
from app.models.reference import (
    CountryDocumentRequirement,
    DocumentRequirementType,
    EmailTemplate,
    KnowledgeArticle,
    Sector,
    SystemSetting,
)
from app.models.referral import (
    ReferralAgent,
    ReferralAgentTarget,
    ReferralCommission,
    ReferralCommissionRule,
)
from app.models.reporting import (
    ExceptionCorrectiveAction,
    ExceptionReport,
    RecruiterNote,
    Report,
    StaffKpiTarget,
    StaffScorecard,
    StaffScorecardArea,
)

__all__ = [
    "Application",
    "AuditLog",
    "Campaign",
    "CampaignTarget",
    "Candidate",
    "CandidateMessage",
    "Case",
    "CasePayment",
    "CaseReminder",
    "CaseStageEvent",
    "ConsultationBooking",
    "Contract",
    "Country",
    "CountryDocumentRequirement",
    "Document",
    "DocumentRequirementType",
    "EmailTemplate",
    "EmployerClient",
    "ExceptionCorrectiveAction",
    "ExceptionReport",
    "FeePolicy",
    "InhouseCountryAssignment",
    "Job",
    "JobMilestonePrice",
    "JobPaymentStage",
    "JobPosition",
    "JobSector",
    "KnowledgeArticle",
    "Partner",
    "PartnerCandidate",
    "Payment",
    "RecruiterNote",
    "RecruiterTarget",
    "ReferralAgent",
    "ReferralAgentTarget",
    "ReferralCommission",
    "ReferralCommissionRule",
    "Region",
    "Report",
    "RetentionFollowUp",
    "Sector",
    "StaffKpiTarget",
    "StaffScorecard",
    "StaffScorecardArea",
    "SystemSetting",
    "User",
]
