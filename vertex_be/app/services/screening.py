"""The screening gate (SRS FR-2.5) and the invite it leads to: a port of
vertex/src/server/services/screening.ts for the pipeline handover step 6.2.

Screening is evaluated against the Candidate Information Form itself (the
candidate's own Section 2 answers and their application's Section 1), not
against documents or an account: neither exists yet when a candidate is
screened. tests/test_screening.py checks every failure message is the
website's, word for word.

On a pass the candidate moves to "screened", earns their referral agent the
"qualified" commission, and is due the account-creation invite. The website
sends the invite and the commission email (owner's decision D1, 2026-10-29),
so screen_and_invite() returns what they need.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.candidate import Application, Candidate
from app.models.enums import ApplicationStatus, CandidateLifecycleStatus, ReferralMilestone
from app.services.referrals import CommissionEarned, commission_if_due

MINIMUM_AGE_YEARS = 18
MINIMUM_PASSPORT_VALIDITY_MONTHS = 6


@dataclass(frozen=True)
class ScreeningResult:
    passed: bool
    failures: list[str]


@dataclass(frozen=True)
class Invite:
    """For the website's account-creation invite email."""

    candidate_id: str
    email: str
    full_name: str


@dataclass
class ScreenAndInviteResult:
    passed: bool
    failures: list[str] = field(default_factory=list)
    candidate: Candidate | None = None
    invite: Invite | None = None
    commission: CommissionEarned | None = None


def _now() -> datetime:
    # Stored dates are UTC without a time zone; the website runs in UTC.
    return datetime.now(UTC).replace(tzinfo=None)


def _age(dob: datetime, now: datetime) -> int:
    age = now.year - dob.year
    if (now.month, now.day) < (dob.month, dob.day):
        age -= 1
    return age


def _months_until(date: datetime, now: datetime) -> int:
    # Calendar months, ignoring the day, as the website counts them.
    return (date.year - now.year) * 12 + (date.month - now.month)


def latest_open_application(candidate: Candidate) -> Application | None:
    """The newest application that isn't rejected (the one screened)."""
    open_ones = [a for a in candidate.applications if a.application_status is not ApplicationStatus.rejected]
    return max(open_ones, key=lambda a: a.submitted_at, default=None)


def evaluate_screening_gate(candidate: Candidate, now: datetime | None = None) -> ScreeningResult:
    now = now or _now()
    failures: list[str] = []
    user = candidate.user

    # The account's details first, as `??` takes them: only a missing value
    # falls back, not an empty one.
    full_name = user.full_name if user else candidate.full_name
    email = user.email if user else candidate.email
    phone = user.phone if user and user.phone is not None else candidate.phone

    if not full_name:
        failures.append("Full name is missing.")
    if not candidate.nationality:
        failures.append("Nationality is missing.")
    if not candidate.date_of_birth:
        failures.append("Date of birth is missing.")
    if not candidate.passport_number:
        failures.append("Passport number is missing.")
    if not phone:
        failures.append("Phone number is missing.")
    if not email:
        failures.append("Email address is missing.")

    if candidate.date_of_birth and _age(candidate.date_of_birth, now) < MINIMUM_AGE_YEARS:
        failures.append(f"Candidate is under the minimum eligible age of {MINIMUM_AGE_YEARS}.")

    if not candidate.passport_expiry:
        failures.append("Passport expiry date is missing.")
    elif _months_until(candidate.passport_expiry, now) < MINIMUM_PASSPORT_VALIDITY_MONTHS:
        failures.append(f"Passport must have at least {MINIMUM_PASSPORT_VALIDITY_MONTHS} months' validity remaining.")

    application = latest_open_application(candidate)
    if application is None:
        failures.append("No Candidate Information Form submission on file.")
    else:
        # A job pick implies both a destination and a type of work; older
        # applications chose a country and a sector instead.
        if not application.job_id:
            if not application.preferred_country_1_id:
                failures.append("Preferred programme country is missing.")
            if not application.preferred_sector_id:
                failures.append("Preferred type of work is missing.")
        if not application.earliest_travel_date:
            failures.append("Earliest possible travel date is missing.")

    if not candidate.consent_given:
        failures.append("Candidate consent has not been recorded.")

    return ScreeningResult(passed=not failures, failures=failures)


def screen_and_invite(db: Session, candidate_id: str) -> ScreenAndInviteResult:
    """Records the gate's result whatever it is; on a pass, moves the
    candidate to "screened" and works out the invite and any commission.
    Writes in the caller's session (so its audit actor), uncommitted."""
    # populate_existing: the caller may have just added the application this
    # screens, after the candidate was loaded.
    candidate = db.scalar(
        select(Candidate)
        .where(Candidate.id == candidate_id)
        .options(selectinload(Candidate.applications), selectinload(Candidate.user))
        .execution_options(populate_existing=True)
    )
    if candidate is None:
        return ScreenAndInviteResult(passed=False, failures=["Candidate not found."])

    screening = evaluate_screening_gate(candidate)
    candidate.screening_result = screening.passed
    candidate.screening_evaluated_at = _now()
    if not screening.passed:
        db.flush()
        return ScreenAndInviteResult(passed=False, failures=screening.failures)

    candidate.lifecycle_status = CandidateLifecycleStatus.screened
    candidate.return_reason = None
    db.flush()

    commission = commission_if_due(db, candidate.id, ReferralMilestone.qualified)
    invite = None
    if not candidate.user_id and candidate.email:
        invite = Invite(candidate.id, candidate.email, candidate.full_name or "there")
    return ScreenAndInviteResult(passed=True, candidate=candidate, invite=invite, commission=commission)
