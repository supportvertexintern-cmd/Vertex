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
from app.models.enums import ApplicationStatus, ReferralMilestone
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


Notice = Annotated[
    InviteEmail | CommissionEmail | MessageEmail | ApplicationConfirmationEmail | ApplicationStatusEmail,
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
