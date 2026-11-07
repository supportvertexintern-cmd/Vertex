"""The Playwright journeys' fixtures (the website's e2e/global-setup.ts and
global-teardown.ts until reads handover R8): real accounts with a known
password, and what a journey needs to look up or shortcut in the database.
It creates and deletes users, so it refuses anything but a local database.

    DATABASE_URL=... python -m scripts.seed.e2e setup | teardown     (from vertex_be/)
    ... candidate <name>              the candidate, as JSON (has_case: a case exists)
    ... partner-login <contact email> the partner's user id
    ... claim <name> <email> <password>  a candidate's account, as if they'd used their invite
    ... alert <email>                  an open security alert about that account, as the monitor writes one
"""

from __future__ import annotations

import json
import sys
from urllib.parse import urlsplit

from sqlalchemy import delete, insert, select
from sqlalchemy.orm import Session

from scripts.seed.common import database_url, first, hash_password, purge, run, upsert

from app.models.campaign import RecruiterTarget  # noqa: E402  (after common sets the path)
from app.models.candidate import Application, Candidate  # noqa: E402
from app.models.cases import Case  # noqa: E402
from app.models.enums import ApplicationStatus, CandidateLifecycleStatus, CandidateSource, JobStatus, Role  # noqa: E402
from app.models.identity import Country, InhouseCountryAssignment, Region, User  # noqa: E402
from app.models.jobs import Job  # noqa: E402
from app.models.partners import Partner, PartnerCandidate  # noqa: E402
from app.models.reference import SystemSetting  # noqa: E402
from app.models.security import SecurityAlert  # noqa: E402
from app.db.base import new_id  # noqa: E402
from app.models.reporting import StaffKpiTarget  # noqa: E402

PASSWORD = "E2ETestPassword123!"  # gitleaks:allow  (a throwaway test database)
PARTNER = "E2E Test Partner"
JOB = "E2E Test Job"
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "postgres", "db"}


def assert_local_database(url: str) -> None:
    host = urlsplit(url).hostname or ""
    if host not in LOCAL_HOSTS:
        raise SystemExit(f'E2E refuses to run against a non-local database (host "{host or "unset"}"); point DATABASE_URL at a throwaway one')


def setup(db: Session) -> None:
    password_hash = hash_password(PASSWORD)

    def account(email: str, full_name: str, role: Role, **extra) -> User:
        return upsert(db, User, {"email": email}, {"role": role, "password_hash": password_hash, "email_verified": True, **extra}, {"full_name": full_name})

    # Anonymous /apply submissions go into the CRM (self-application.spec.ts).
    upsert(db, SystemSetting, {"key": "intake_mode"}, {"value": "crm"})
    account("e2e-admin@test.local", "E2E Admin", Role.admin)

    # Their own region and country, so the suite needs no reference data.
    region = upsert(db, Region, {"name": "E2E Region"})
    country = upsert(db, Country, {"name": "E2E Country"}, create={"region_id": region.id})

    # In-House's "approved" is a tier above the country supervisor's
    # "verified", and their list is scoped by this assignment.
    inhouse = account("e2e-inhouse@test.local", "E2E In-House Supervisor", Role.inhouse_supervisor)
    upsert(db, InhouseCountryAssignment, {"inhouse_supervisor_id": inhouse.id, "country_id": country.id})
    supervisor = account("e2e-supervisor@test.local", "E2E Supervisor", Role.country_supervisor, assigned_country_id=country.id)
    account("e2e-recruiter@test.local", "E2E Recruiter", Role.regional_recruiter, assigned_country_id=country.id, supervisor_id=supervisor.id)
    account("e2e-hr@test.local", "E2E HR", Role.hr)
    account("e2e-operations@test.local", "E2E Operations", Role.operations_team)
    account("e2e-operations-director@test.local", "E2E Operations Director", Role.operations_director)
    account("e2e-finance@test.local", "E2E Finance", Role.finance)

    job = first(db, Job, title=JOB)
    if job is None:
        job = Job(
            title=JOB, country="Kenya", city="Nairobi", status=JobStatus.active, application_fee=0,
            job_description="A job created solely for the E2E suite's real-application submission test.",
            requirements="None — this posting exists only for automated testing.",
        )
        db.add(job)
        db.flush()

    # One step short of "approved", with a pending application, so the case
    # journey starts at In-House approving through the real UI. country_id
    # puts them in In-House's list.
    login = account("e2e-case-candidate@test.local", "E2E Case Candidate", Role.candidate)
    candidate = upsert(db, Candidate, {"user_id": login.id}, {"lifecycle_status": CandidateLifecycleStatus.verified, "country_id": country.id}, {
        "source": CandidateSource.self_registered,
    })
    upsert(db, Application, {"candidate_id": candidate.id, "job_id": job.id}, {"application_status": ApplicationStatus.submitted})
    db.flush()


def teardown(db: Session) -> None:
    e2e_users = select(User.id).where(User.email.startswith("e2e-", autoescape=True), User.email.endswith("@test.local", autoescape=True))
    partners = select(Partner.id).where(Partner.name == PARTNER)
    # A candidate only loses its recruiter or partner when those go, so
    # candidates go first, or every run leaves one behind.
    purge(db, delete(Candidate).where(Candidate.recruiter_id.in_(e2e_users)))
    purge(db, delete(Candidate).where(Candidate.partner_id.in_(partners)))
    purge(db, delete(SecurityAlert).where(SecurityAlert.alert_key.startswith("e2e:", autoescape=True)))
    # Restricted foreign keys to the country: before the country goes.
    purge(db, delete(PartnerCandidate).where(PartnerCandidate.partner_id.in_(partners)))
    purge(db, delete(Partner).where(Partner.name == PARTNER))
    # set_by is NOT NULL yet ON DELETE SET NULL, so a target an e2e user set
    # blocks deleting them.
    purge(db, delete(StaffKpiTarget).where(StaffKpiTarget.set_by.in_(e2e_users)))
    purge(db, delete(RecruiterTarget).where(RecruiterTarget.set_by.in_(e2e_users)))
    purge(db, delete(User).where(User.id.in_(e2e_users)))
    purge(db, delete(Country).where(Country.name == "E2E Country"))
    purge(db, delete(Region).where(Region.name == "E2E Region"))
    purge(db, delete(Job).where(Job.title == JOB))  # its applications cascade


def candidate(db: Session, name: str) -> dict:
    row = first(db, Candidate, full_name=name)
    if row is None:
        raise SystemExit(f"No candidate named {name!r}")
    case = db.scalar(select(Case.id).join(Application, Case.application_id == Application.id).where(Application.candidate_id == row.id).limit(1))
    return {
        "id": row.id, "source": row.source.value, "recruiter_id": row.recruiter_id, "lifecycle_status": row.lifecycle_status.value, "has_case": case is not None,
    }


def partner_login(db: Session, contact_email: str) -> dict:
    partner = first(db, Partner, contact_email=contact_email)
    return {"user_id": partner.user_id if partner else None}


def claim(db: Session, name: str, email: str, password: str) -> dict:
    """The candidate's account, skipping the invite email (no inbox in CI)."""
    row = first(db, Candidate, full_name=name)
    if row is None:
        raise SystemExit(f"No candidate named {name!r}")
    user = User(full_name=name, email=email, password_hash=hash_password(password), role=Role.candidate, email_verified=True)
    db.add(user)
    db.flush()
    row.user_id = user.id
    row.lifecycle_status = CandidateLifecycleStatus.guided_to_apply
    db.flush()
    return {"id": row.id}


def alert(db: Session, email: str) -> dict:
    """An open alert about the account, as security_monitor.raise_alert writes it
    (straight to the table, as the monitor does)."""
    user = first(db, User, email=email)
    if user is None:
        raise SystemExit(f"No account {email!r}")
    row = {
        "id": new_id(), "rule": "brute_force_account", "alert_key": f"e2e:brute_force_account:{user.id}", "severity": "high",
        "summary": "10 failed sign-ins for one account in 15 minutes", "user_id": user.id, "ip": "198.51.100.23",
        "detail": {"failures": 10, "last_ip": "198.51.100.23"}, "status": "open",
    }
    db.connection().execute(insert(SecurityAlert.__table__).values(row))
    return {"id": row["id"]}


COMMANDS = {"setup": setup, "teardown": teardown, "candidate": candidate, "partner-login": partner_login, "claim": claim, "alert": alert}


if __name__ == "__main__":
    assert_local_database(database_url())
    command, *args = sys.argv[1:] or ["?"]
    if command not in COMMANDS:
        raise SystemExit(f"usage: python -m scripts.seed.e2e {' | '.join(COMMANDS)}")
    print(json.dumps(run(lambda db: COMMANDS[command](db, *args))))
