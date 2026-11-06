"""Demo data for the customer-facing site (docs/demo-site.md). Invented people
and records only: every email is @example.com, every phone number fictional.
Run after the reference data:

    DEMO_SEED=yes DEMO_ACCOUNTS_FILE=<path outside the repo> DATABASE_URL=... python -m scripts.seed.demo

Refuses without DEMO_SEED=yes, and on any database holding a real user (an
email not ending in @example.com): it must never touch a stack's database.
One random password per account goes to DEMO_ACCOUNTS_FILE, never printed.
"""

from __future__ import annotations

import os
import secrets

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from scripts.seed.common import first, hash_password, run

from app.core.clock import utc_now_ms  # noqa: E402  (after common sets the path)
from app.models.candidate import Application, Candidate  # noqa: E402
from app.models.cases import Case, CasePayment, CaseStageEvent  # noqa: E402
from app.models.enums import (  # noqa: E402
    ApplicationStatus,
    CandidateLifecycleStatus,
    CasePaymentStatus,
    CaseStage,
    PartnerCandidateStatus,
    PartnerStatus,
    PartnerType,
    Role,
)
from app.models.identity import Country, User  # noqa: E402
from app.models.jobs import Job, JobPaymentStage  # noqa: E402
from app.models.partners import Partner, PartnerCandidate  # noqa: E402

DOMAIN = "@example.com"
STAFF = [
    (Role.admin, "Demo Admin", "admin"),
    (Role.director, "Demo Director", "director"),
    (Role.hr, "Demo HR", "hr"),
    (Role.operations_team, "Demo Operations", "operations"),
    (Role.operations_director, "Demo Operations Director", "operations.director"),
    (Role.finance, "Demo Finance", "finance"),
    (Role.regional_recruiter, "Demo Recruiter", "recruiter"),
    (Role.country_supervisor, "Demo Country Supervisor", "supervisor"),
    (Role.marketing, "Demo Marketing", "marketing"),
]
# Name, nationality, lifecycle status, application status, case stage.
CANDIDATES = [
    ("Amina Demo", "Kenyan", "submitted", "submitted", None),
    ("Daniel Sample", "Ugandan", "submitted", "under_review", None),
    ("Grace Example", "Ghanaian", "approved", "approved", "registration_document_submission"),
    ("Joseph Placeholder", "Nigerian", "approved", "approved", "permit_application_submission"),
    ("Mary Fictional", "Kenyan", "approved", "approved", "visa_interview_preparation"),
    ("Peter Testcase", "Ugandan", "screened", None, None),
]


def seed(db: Session) -> list[str]:
    """The accounts' lines for the file; empty when already loaded."""
    real = db.scalar(select(func.count()).select_from(User).where(User.email.not_like(f"%{DOMAIN}")))
    if real:
        raise SystemExit(f"Refusing: this database holds {real} non-demo user(s). Demo data goes only into the demo database.")
    if first(db, User, email=f"demo.admin{DOMAIN}"):
        return []
    jobs = db.scalars(select(Job).order_by(Job.created_at).limit(5)).all()
    country = first(db, Country, name="Kenya")
    if not jobs or country is None:
        raise SystemExit("Run the reference data (scripts.seed.reference) first.")

    lines: list[str] = []

    def account(key: str, full_name: str, role: Role, **extra) -> User:
        password = secrets.token_urlsafe(12)
        user = User(email=f"demo.{key}{DOMAIN}", full_name=full_name, role=role, email_verified=True, password_hash=hash_password(password, 10), **extra)
        db.add(user)
        db.flush()
        lines.append(f"{role.value:<20} {user.email:<40} {password}")
        return user

    staff = {
        key: account(key, name, role, **({"assigned_country_id": country.id} if role in (Role.regional_recruiter, Role.country_supervisor) else {}))
        for role, name, key in STAFF
    }

    # One partner with a login and two candidates in progress.
    login = account("partner", "Demo Partner Agency", Role.partner)
    partner = Partner(
        name="Demo Partner Agency", partner_type=PartnerType.manpower_supplier, country_of_operation="Kenya", contact_name="Demo Partner Contact",
        contact_email=f"partner.contact{DOMAIN}", contact_phone="+254 700 000 000", status=PartnerStatus.active, user_id=login.id,
    )
    db.add(partner)
    db.flush()
    db.add(PartnerCandidate(partner_id=partner.id, status=PartnerCandidateStatus.draft, full_name="Samuel Draftcase", job_id=jobs[0].id))
    db.add(PartnerCandidate(partner_id=partner.id, status=PartnerCandidateStatus.submitted, full_name="Ruth Submitted", job_id=jobs[1 % len(jobs)].id))

    # Candidates at different points of the journey.
    for i, (name, nationality, status, app_status, stage) in enumerate(CANDIDATES):
        user = account(f"candidate{i + 1}", name, Role.candidate)
        candidate = Candidate(
            user_id=user.id, full_name=name, email=user.email, phone=f"+254 700 000 1{i}0", nationality=nationality, country_id=country.id,
            country_name=country.name, lifecycle_status=CandidateLifecycleStatus(status), recruiter_id=staff["recruiter"].id,
            consent_given=True, consent_at=utc_now_ms(),
        )
        db.add(candidate)
        db.flush()
        if app_status is None:
            continue
        job = jobs[i % len(jobs)]
        application = Application(candidate_id=candidate.id, job_id=job.id, application_status=ApplicationStatus(app_status))
        db.add(application)
        db.flush()
        if stage is None:
            continue
        case = Case(application_id=application.id, current_stage=CaseStage(stage))
        db.add(case)
        db.flush()
        db.add(CaseStageEvent(case_id=case.id, stage=CaseStage(stage), owner_id=staff["operations"].id))
        payment_stage = db.scalars(select(JobPaymentStage).where(JobPaymentStage.job_id == job.id).order_by(JobPaymentStage.order)).first()
        if payment_stage is None:
            continue
        db.add(CasePayment(
            case_id=case.id, job_payment_stage_id=payment_stage.id, amount=250, recorded_by=staff["finance"].id,
            status=CasePaymentStatus.pending if stage == "registration_document_submission" else CasePaymentStatus.collected,
        ))
    db.flush()
    return lines


def main() -> None:
    if os.environ.get("DEMO_SEED") != "yes":
        raise SystemExit("Set DEMO_SEED=yes to load demo data")
    out = os.environ.get("DEMO_ACCOUNTS_FILE")
    if not out:
        raise SystemExit("Set DEMO_ACCOUNTS_FILE to a path outside the repository")
    lines = run(seed)
    if not lines:
        print("Demo data already loaded; nothing to do.")
        return
    header = ["Vertex demo site accounts (invented data). Share each customer only the accounts they need.", f"Generated {utc_now_ms().isoformat()}", ""]
    with open(os.open(out, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w", encoding="utf-8") as file:
        file.write("\n".join([*header, *lines, ""]))
    print(f"Demo data loaded: {len(lines)} accounts (passwords in DEMO_ACCOUNTS_FILE).")


if __name__ == "__main__":
    main()
