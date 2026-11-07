"""Partner logins for manual testing on a development stack (password
TestPassword123!, as for every test account). Needs the reference data.

- The partner list (scripts/seed/partners.py) is loaded if it isn't already,
  and each agency gets a login partner-<agency>@test.local, linked as "Create
  Partner Login" links one, and is made active with its MOU signed. Its real
  contact email stays as it is: no real address becomes a login with a public
  password, and nothing is sent.
- Three invented agencies (@test.local) come with candidates at each step a
  partner sees: a draft, submitted, under review and rejected.

Safe to re-run: logins by email, agencies by contact email, candidates by name.

    DATABASE_URL=... python -m scripts.seed.partner_logins     (from vertex_be/)
"""

from __future__ import annotations

import re
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from scripts.seed import partners
from scripts.seed.common import first, hash_password, run, upsert
from scripts.seed.test_accounts import PASSWORD

from app.core.clock import utc_now_ms  # noqa: E402  (after common sets the path)
from app.models.enums import JobStatus, MouStatus, PartnerCandidateStatus, PartnerStatus, PartnerType, Role  # noqa: E402
from app.models.identity import User  # noqa: E402
from app.models.jobs import Job  # noqa: E402
from app.models.partners import Partner, PartnerCandidate  # noqa: E402

DOMAIN = "@test.local"

# Invented agencies: name, country, contact, type.
NEW_AGENCIES = [
    ("Test Horizon Staffing", "Kenya", "Test Horizon Contact", PartnerType.manpower_supplier),
    ("Test Lakeside Recruitment", "Uganda", "Test Lakeside Contact", PartnerType.manpower_supplier),
    ("Test Atlas Placements", "Nigeria", "Test Atlas Contact", PartnerType.manpower_supplier),
]

# Each invented agency's candidates: name suffix, status, nationality.
CANDIDATES = [
    ("Draft", PartnerCandidateStatus.draft),
    ("Submitted", PartnerCandidateStatus.submitted),
    ("Reviewing", PartnerCandidateStatus.under_review),
    ("Rejected", PartnerCandidateStatus.rejected),
]


def login_email(company: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", company.lower()).strip("-")
    return f"partner-{slug}{DOMAIN}"


def _activate(db: Session, partner: Partner, email: str, password_hash: str) -> User:
    login = upsert(db, User, {"email": email}, {"role": Role.partner, "email_verified": True}, {
        "full_name": partner.contact_name, "password_hash": password_hash,
    })
    if partner.user_id is None:
        partner.user_id = login.id
    if partner.status is not PartnerStatus.active or partner.mou_status is not MouStatus.signed:
        partner.status, partner.mou_status = PartnerStatus.active, MouStatus.signed
        partner.mou_signed_at = partner.mou_signed_at or utc_now_ms()
    return login


def seed(db: Session) -> dict[str, int]:
    password_hash = hash_password(PASSWORD)
    jobs = db.scalars(select(Job).where(Job.status == JobStatus.active).order_by(Job.created_at, Job.id)).all()
    if not jobs:
        raise SystemExit("No active jobs: run scripts.seed.reference against this database first.")

    partners.seed(db)
    listed = 0
    for p in partners.PARTNERS:
        partner = first(db, Partner, contact_email=p["email"])
        _activate(db, partner, login_email(p["company"]), password_hash)
        listed += 1

    created = 0
    now = utc_now_ms()
    for name, country, contact, kind in NEW_AGENCIES:
        email = login_email(name)
        partner = upsert(db, Partner, {"contact_email": email}, None, {
            "name": name, "partner_type": kind, "country_of_operation": country, "contact_name": contact, "contact_phone": "N/A",
        })
        login = _activate(db, partner, email, password_hash)
        for i, (suffix, status) in enumerate(CANDIDATES):
            full_name = f"{name.removeprefix('Test ').split()[0]} {suffix} Candidate"
            if first(db, PartnerCandidate, partner_id=partner.id, full_name=full_name) is not None:
                continue
            drafted = now - timedelta(days=10 - i)
            submitted = status is not PartnerCandidateStatus.draft
            db.add(PartnerCandidate(
                partner_id=partner.id, status=status, full_name=full_name, nationality=country, job_id=jobs[i % len(jobs)].id,
                drafted_at=drafted, drafted_by=login.id,
                submitted_at=drafted + timedelta(days=1) if submitted else None, submitted_by=login.id if submitted else None,
            ))
            created += 1
    db.flush()
    return {"listed agencies with logins": listed, "invented agencies": len(NEW_AGENCIES), "candidates created": created}


if __name__ == "__main__":
    print(f"Done: {run(seed)}. Password for every login: {PASSWORD}")
