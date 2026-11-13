"""The virtual-assistant demo cast, for walking through the partner tracking
flows on a development stack (password TestPassword123!, as for every test
account). Needs the reference data (an active programme).

- Michael (director), Sarah and Daniel (virtual assistants), @va-demo.test.
- Five partner agencies at different onboarding states, so each "needs a
  follow-up" flag shows: Addis (Sarah; MOU, SLA and documents in), Horizon
  (Sarah; SLA sent, not signed), Global Talent (Daniel; MOU sent, no SLA, no
  documents), Bright Future (Daniel; signed, no documents) and Prime
  Overseas (nobody assigned, nothing signed).
- Abel (Addis, submitted), Tigist (Horizon, under review) and Meron (Global
  Talent, job assigned, with an approved candidate and an open case), each a
  partner submission bridged to a candidate with an application.
- One submitted report (Addis) and two open follow-ups (Horizon's SLA, and
  assigning Prime a VA).

The agencies' addresses are invented (@va-demo.test): nothing is sent.
Safe to re-run: people and agencies by email, candidates by passport number,
the report and follow-ups by agency and wording.

    DATABASE_URL=... python -m scripts.seed.va_demo     (from vertex_be/)
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from scripts.seed.common import first, hash_password, run, upsert
from scripts.seed.test_accounts import PASSWORD

from app.core.clock import utc_now_ms  # noqa: E402  (after common sets the path)
from app.models.candidate import Application, Candidate  # noqa: E402
from app.models.cases import Case, CaseStageEvent  # noqa: E402
from app.models.enums import (  # noqa: E402
    CandidateLifecycleStatus,
    CandidateSource,
    CaseStage,
    ContactChannel,
    JobStatus,
    MouStatus,
    PartnerCandidateStatus,
    PartnerFollowUpStatus,
    PartnerReportStatus,
    PartnerStatus,
    PartnerType,
    Role,
    SlaStatus,
)
from app.models.identity import User  # noqa: E402
from app.models.jobs import Job  # noqa: E402
from app.models.partner_tracking import PartnerFollowUp, PartnerReport  # noqa: E402
from app.models.partners import Partner, PartnerCandidate  # noqa: E402

DOMAIN = "@va-demo.test"

PEOPLE = [("michael", "Michael", Role.director), ("sarah", "Sarah", Role.virtual_assistant), ("daniel", "Daniel", Role.virtual_assistant)]

# name, contact, country, looked after by, MOU, SLA, documents in.
AGENCIES = [
    ("Addis Recruitment PLC", "Samuel", "Ethiopia", "sarah", MouStatus.signed, SlaStatus.signed, True),
    ("Horizon Employment Agency", "Helen", "Kenya", "sarah", MouStatus.signed, SlaStatus.sent, True),
    ("Global Talent Solutions", "Yonas", "Uganda", "daniel", MouStatus.sent, SlaStatus.none, False),
    ("Bright Future Recruitment", "Rahel", "Rwanda", "daniel", MouStatus.signed, SlaStatus.signed, False),
    ("Prime Overseas Agency", "Kebede", "Ethiopia", None, MouStatus.none, SlaStatus.none, False),
]

# name, agency, passport, nationality, where they live, submission status.
CANDIDATES = [
    ("Abel Tesfaye", "Addis Recruitment PLC", "VADEMOABEL001", "Ethiopian", "Ethiopia", PartnerCandidateStatus.submitted),
    ("Tigist Bekele", "Horizon Employment Agency", "VADEMOTIGIST002", "Kenyan", "Kenya", PartnerCandidateStatus.under_review),
    ("Meron Haile", "Global Talent Solutions", "VADEMOMERON003", "Ugandan", "Uganda", PartnerCandidateStatus.job_assigned),
]

FOLLOW_UPS = [("Horizon Employment Agency", "Chase the signed SLA", "sarah"), ("Prime Overseas Agency", "Assign a VA and request onboarding documents", "michael")]

BORN, PASSPORT_EXPIRES = datetime(1996, 5, 10), datetime(2032, 1, 1)


def seed(db: Session) -> dict[str, int]:
    job = db.scalars(select(Job).where(Job.status == JobStatus.active).order_by(Job.created_at.desc(), Job.id)).first()
    if job is None:
        raise SystemExit("No active programme: run scripts.seed.reference against this database first.")
    now = utc_now_ms()
    password_hash = hash_password(PASSWORD)

    people = {
        key: upsert(db, User, {"email": f"{key}{DOMAIN}"}, {"full_name": name, "role": role, "email_verified": True}, {"password_hash": password_hash})
        for key, name, role in PEOPLE
    }

    agencies: dict[str, Partner] = {}
    for name, contact, country, keeper, mou, sla, documents in AGENCIES:
        agencies[name] = upsert(db, Partner, {"contact_email": f"{contact.lower()}{DOMAIN}"}, {
            "name": name, "partner_type": PartnerType.manpower_supplier, "country_of_operation": country, "contact_name": contact,
            "status": PartnerStatus.active, "mou_status": mou, "mou_signed_at": now if mou is MouStatus.signed else None,
            "sla_status": sla, "sla_signed_at": now if sla is SlaStatus.signed else None,
            "onboarding_documents": ["business_registration", "director_id"] if documents else [],
            "documents_submitted_at": now if documents else None,
            "assigned_team_member_id": people[keeper].id if keeper else None,
        }, {"contact_phone": "+44 0000 000000", "notes": "Demo agency for the virtual-assistant flows (scripts/seed/va_demo.py)."})

    created = 0
    for full_name, agency, passport, nationality, home, status in CANDIDATES:
        partner = agencies[agency]
        if first(db, PartnerCandidate, passport_number=passport) is not None:
            continue
        approved = status is PartnerCandidateStatus.job_assigned
        candidate = Candidate(
            full_name=full_name, email=f"{full_name.split()[0].lower()}{DOMAIN}", phone="+44 0000 000111", nationality=nationality,
            passport_number=passport, passport_expiry=PASSPORT_EXPIRES, date_of_birth=BORN, source=CandidateSource.partner_sourced,
            partner_id=partner.id, lifecycle_status=CandidateLifecycleStatus.approved if approved else CandidateLifecycleStatus.submitted,
        )
        db.add(candidate)
        db.flush()
        application = Application(candidate_id=candidate.id, job_id=job.id, current_location_country_name=home)
        db.add(application)
        db.add(PartnerCandidate(
            partner_id=partner.id, status=status, full_name=full_name, date_of_birth=BORN, nationality=nationality, passport_number=passport,
            passport_expiry=PASSPORT_EXPIRES, job_id=job.id, submitted_at=now, documents_available=["passport", "passport_photo"],
            payment_plan_acknowledged=True, current_location_country_name=home, available_for_embassy_appointment=True,
            willing_to_start_within_30_days=True, preferred_contact_channel=ContactChannel.email, bridged_candidate_id=candidate.id,
        ))
        db.flush()
        if approved:
            case = Case(application_id=application.id)
            db.add(case)
            db.flush()
            db.add(CaseStageEvent(case_id=case.id, stage=CaseStage.registration_document_submission))
        created += 1

    addis = agencies["Addis Recruitment PLC"]
    if first(db, PartnerReport, partner_id=addis.id) is None:
        db.add(PartnerReport(
            partner_id=addis.id, reported_at=now, status=PartnerReportStatus.submitted, submitted_by=people["sarah"].id,
            content={"notes": "Initial partner report: sourcing activity in Addis Ababa."},
        ))
    for agency, action, who in FOLLOW_UPS:
        upsert(db, PartnerFollowUp, {"partner_id": agencies[agency].id, "action": action}, None, {
            "status": PartnerFollowUpStatus.open, "assigned_team_member": people[who].id,
        })
    db.flush()
    return {"people": len(people), "agencies": len(agencies), "candidates created": created}


if __name__ == "__main__":
    print(f"Done: {run(seed)}. Sign in as michael{DOMAIN}, sarah{DOMAIN} or daniel{DOMAIN}; password {PASSWORD}")
