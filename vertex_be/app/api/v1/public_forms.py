"""The public contact form and the Candidate Information Form while it's
emailed (reads handover R7b): POST /api/contact and
/api/public-intake/application pass on here, and FastAPI sends the email
the request exists to send.

Neither writes anything: the email is the only record, so it's sent in the
request and a failure, an unset PUBLIC_FORMS_NOTIFY_EMAIL included, is a
502 the visitor sees, as the website's routes answered. The website keeps
the per-address rate limits and the form's validation (its messages); only
it may call these (calling_service).
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field

from app.api.deps import DbSession
from app.api.v1.jobs import find_public_job
from app.core.api import ApiError, Data
from app.core.auth import OptionalUser, calling_service
from app.core.config import settings
from app.core.logging import log_event
from app.models.enums import JobStatus
from app.services import emails

router = APIRouter(prefix="/public-forms", dependencies=[Depends(calling_service)])


class Sent(BaseModel):
    sent: bool = True


class ContactIn(BaseModel):
    """contactMessageSchema."""

    name: str = Field(min_length=2, max_length=150)
    email: str = Field(max_length=320)
    subject: str = Field(min_length=2, max_length=200)
    message: str = Field(min_length=10, max_length=5000)
    registration_number: str | None = Field(default=None, max_length=100)


class IntakeIn(BaseModel):
    """The CIF's fields the email shows (submitApplicationSchema, checked by the website)."""

    job_id: str
    full_name: str = Field(min_length=2, max_length=100)
    email: str = Field(max_length=320)
    phone: str | None = None
    nationality: str | None = None
    passport_number: str | None = None
    earliest_travel_date: str
    prior_eu_visa_applied: bool | None = None
    prior_eu_visa_applied_details: str | None = None
    documents_available: list[str] = []
    current_location_country_name: str
    holds_schengen_visa: bool | None = None
    holds_schengen_visa_details: str | None = None
    prior_visa_refusals: bool | None = None
    prior_visa_refusals_details: str | None = None
    available_for_embassy_appointment: bool
    willing_to_start_within_30_days: bool
    preferred_contact_channel: str | None = None
    cover_letter: str | None = None


CONTACT_FAILED = "We couldn't send your message right now. Please try again shortly or email us directly."
INTAKE_FAILED = "We couldn't submit your application right now. Please try again shortly or contact us directly."


def _inbox(kind: str, message: str) -> str:
    if not settings.PUBLIC_FORMS_NOTIFY_EMAIL:
        log_event(logging.ERROR, "email.recipient_not_configured", kind=kind)
        raise ApiError(502, "send_failed", message)
    return settings.PUBLIC_FORMS_NOTIFY_EMAIL


@router.post("/contact", response_model=Data[Sent], status_code=status.HTTP_201_CREATED)
def contact(body: ContactIn, db: DbSession):
    """POST /api/contact: the message, emailed to the team (reply-to the sender)."""
    if not emails.send_now(emails.contact_mail(db, _inbox("contact", CONTACT_FAILED), body)):
        raise ApiError(502, "send_failed", CONTACT_FAILED)
    return {"data": Sent()}


@router.post("/intake", response_model=Data[Sent], status_code=status.HTTP_201_CREATED)
def intake(body: IntakeIn, db: DbSession, user: OptionalUser):
    """POST /api/public-intake/application: the CIF, emailed to the team for
    a public job still taking applications, then a confirmation to the
    applicant, off the request."""
    job = find_public_job(db, body.job_id, user)
    if job is None:
        raise ApiError(404, "not_found", "Opportunity not found.")
    if job.status != JobStatus.active:
        raise ApiError(404, "closed", "Applications for this programme are closed.")
    mail = emails.intake_mail(db, _inbox("public_intake", INTAKE_FAILED), body, job.title, job.country, job.city)
    if not emails.send_now(mail):
        raise ApiError(502, "send_failed", INTAKE_FAILED)
    emails.send_later(emails.intake_confirmation_mail(db, body.email, body.full_name))
    return {"data": Sent()}
