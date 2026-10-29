"""The emails a pipeline write leaves due, which the website sends once
FastAPI has answered (owner's decision D1, 2026-10-29;
docs/architecture/pipeline-handover.md §4.1). A response lists them in
`notify`, next to `data`; each names the lib/email.ts sender it's for and
carries that sender's arguments. The website never passes `notify` on to
the browser.
"""

from __future__ import annotations

from typing import Annotated, Generic, Literal, TypeVar

from pydantic import BaseModel, Field

from app.core.api import Data
from app.models.enums import ApplicationStatus, CaseReminderChannel, CaseStage, ReferralMilestone
from app.services.referrals import CommissionEarned
from app.services.screening import Invite

class InviteEmail(BaseModel):
    """sendCandidateInviteEmail(candidate_id, email, full_name)."""

    kind: Literal["candidate_invite"] = "candidate_invite"
    candidate_id: str
    email: str
    full_name: str


class CommissionEmail(BaseModel):
    """sendReferralCommissionEarnedEmail(agent_email, agent_name, candidate_name, milestone, amount, currency)."""

    kind: Literal["referral_commission_earned"] = "referral_commission_earned"
    agent_email: str
    agent_name: str
    candidate_name: str
    milestone: ReferralMilestone
    amount: float
    currency: str


class MessageEmail(BaseModel):
    """sendCandidateMessageNotificationEmail(email, full_name, app URL + view_path)."""

    kind: Literal["candidate_message"] = "candidate_message"
    email: str
    full_name: str
    view_path: str


class ApplicationConfirmationEmail(BaseModel):
    """sendApplicationConfirmationEmail(email, full_name, job_title, has_account)."""

    kind: Literal["application_confirmation"] = "application_confirmation"
    email: str
    full_name: str
    job_title: str
    has_account: bool


class ApplicationStatusEmail(BaseModel):
    """sendStatusUpdateEmail(email, full_name, job_title, status)."""

    kind: Literal["application_status"] = "application_status"
    email: str
    full_name: str
    job_title: str
    status: ApplicationStatus


class CandidateApprovedEmail(BaseModel):
    """sendCandidateApprovedEmail(email, full_name)."""

    kind: Literal["candidate_approved"] = "candidate_approved"
    email: str
    full_name: str


class CaseStageEmail(BaseModel):
    """sendCaseStageUpdateEmail(email, full_name, job_title, stage)."""

    kind: Literal["case_stage"] = "case_stage"
    email: str
    full_name: str
    job_title: str
    stage: CaseStage


class PartnerCaseStageEmail(BaseModel):
    """sendPartnerCaseStageUpdateEmail(email, partner_name, candidate_name, job_title, stage)."""

    kind: Literal["partner_case_stage"] = "partner_case_stage"
    email: str
    partner_name: str
    candidate_name: str
    job_title: str
    stage: CaseStage


class CaseRejectedEmail(BaseModel):
    """sendCaseRejectedEmail(email, full_name, candidate_name, job_title, reason): one per HR user."""

    kind: Literal["case_rejected"] = "case_rejected"
    email: str
    full_name: str
    candidate_name: str
    job_title: str
    reason: str


class PartnerCaseRejectedEmail(BaseModel):
    """sendPartnerCaseRejectedEmail(email, partner_name, candidate_name, job_title, reason)."""

    kind: Literal["partner_case_rejected"] = "partner_case_rejected"
    email: str
    partner_name: str
    candidate_name: str
    job_title: str
    reason: str


class CaseReminderEmail(BaseModel):
    """sendCaseReminderEmail(email, recipient_name, candidate_name, programme_title, channel, message)."""

    kind: Literal["case_reminder"] = "case_reminder"
    email: str
    recipient_name: str
    candidate_name: str
    programme_title: str
    channel: CaseReminderChannel
    message: str | None


class PartnerSubmittedEmail(BaseModel):
    """sendPartnerCandidateSubmittedEmail(partner_name, candidate_name), to the
    website's PARTNER_SUBMISSION_NOTIFY_EMAIL."""

    kind: Literal["partner_candidate_submitted"] = "partner_candidate_submitted"
    partner_name: str
    candidate_name: str


class PartnerCaseCreatedEmail(BaseModel):
    """sendPartnerCaseCreatedEmail(email, partner_name, candidate_name)."""

    kind: Literal["partner_case_created"] = "partner_case_created"
    email: str
    partner_name: str
    candidate_name: str


class PartnerSubmissionRejectedEmail(BaseModel):
    """sendPartnerCandidateRejectedEmail(email, partner_name, candidate_name, reason)."""

    kind: Literal["partner_candidate_rejected"] = "partner_candidate_rejected"
    email: str
    partner_name: str
    candidate_name: str
    reason: str


class CommissionApprovedEmail(BaseModel):
    """sendReferralCommissionApprovedEmail(email, agent_name, candidate_name, amount, currency)."""

    kind: Literal["referral_commission_approved"] = "referral_commission_approved"
    email: str
    agent_name: str
    candidate_name: str
    amount: float
    currency: str


class CommissionPaidEmail(BaseModel):
    """sendReferralCommissionPaidEmail(email, agent_name, candidate_name, amount, currency)."""

    kind: Literal["referral_commission_paid"] = "referral_commission_paid"
    email: str
    agent_name: str
    candidate_name: str
    amount: float
    currency: str


class ConsultationBookedEmail(BaseModel):
    """sendConsultationBookingNotification({fullName, email, phone, amount, currency})."""

    kind: Literal["consultation_booked"] = "consultation_booked"
    full_name: str | None
    email: str
    phone: str | None
    amount: float
    currency: str


class PaymentReceiptEmail(BaseModel):
    """createReceiptPdf(payment_id, full_name, email, job_title, amount, transaction_id, date):
    the PDF receipt, emailed."""

    kind: Literal["payment_receipt"] = "payment_receipt"
    payment_id: str
    full_name: str
    email: str
    job_title: str
    amount: float
    transaction_id: str
    date: str


class MilestonePlanStage(BaseModel):
    """One row of the payment plan in the link email; the website labels trigger_stage."""

    id: str
    label: str
    percent: float
    amount: float
    trigger_stage: CaseStage


class MilestonePaymentLinkEmail(BaseModel):
    """sendMilestonePaymentLinkEmail(email, recipient_name, candidate_name, programme_title,
    payment_url, current_stage_id, stages)."""

    kind: Literal["milestone_payment_link"] = "milestone_payment_link"
    email: str
    recipient_name: str
    candidate_name: str
    programme_title: str
    payment_url: str
    current_stage_id: str
    stages: list[MilestonePlanStage]


Notice = Annotated[
    InviteEmail
    | CommissionEmail
    | MessageEmail
    | ApplicationConfirmationEmail
    | ApplicationStatusEmail
    | CandidateApprovedEmail
    | CaseStageEmail
    | PartnerCaseStageEmail
    | CaseRejectedEmail
    | PartnerCaseRejectedEmail
    | CaseReminderEmail
    | PartnerSubmittedEmail
    | PartnerCaseCreatedEmail
    | PartnerSubmissionRejectedEmail
    | CommissionApprovedEmail
    | CommissionPaidEmail
    | ConsultationBookedEmail
    | PaymentReceiptEmail
    | MilestonePaymentLinkEmail,
    Field(discriminator="kind"),
]


T = TypeVar("T")


class Notifying(Data[T], Generic[T]):
    notify: list[Notice] = []


def invite_email(invite: Invite | None) -> list[Notice]:
    return [InviteEmail(candidate_id=invite.candidate_id, email=invite.email, full_name=invite.full_name)] if invite else []


def commission_email(earned: CommissionEarned | None) -> list[Notice]:
    if earned is None:
        return []
    return [
        CommissionEmail(
            agent_email=earned.agent_email,
            agent_name=earned.agent_name,
            candidate_name=earned.candidate_name,
            milestone=earned.milestone,
            amount=float(earned.amount),
            currency=earned.currency,
        )
    ]
