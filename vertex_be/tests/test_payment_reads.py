"""Reads handover R6: a case's payments, a user's own payments, consultation
bookings, Finance's payments-due worklist and the staff directory
(app/api/v1/payment_reads.py). Each answers as the website's Prisma read
did: the same rows for the same caller, the same order and JSON keys."""

import secrets
from datetime import datetime

import pytest

from app.api.v1.payment_reads import PAYMENT_READERS
from app.core.rbac import FINANCE_ROLES, OPERATIONS_ROLES
from app.models.candidate import Application, Candidate
from app.models.cases import Case, CasePayment, FeePolicy
from app.models.enums import CandidateSource, CasePaymentStatus, CaseStage, PaymentStatus, Role
from app.models.identity import Country, InhouseCountryAssignment, Region
from app.models.jobs import Job, JobPaymentStage
from app.models.partners import Partner
from app.models.payments import ConsultationBooking, Payment
from tests.test_case_reads import add_user, api, data, h, tag  # noqa: F401  (api is a fixture)


@pytest.fixture
def world(db):
    region = Region(name=f"Payregion {tag()}")
    db.add(region)
    db.flush()
    home = Country(name=f"Payhome {tag()}", region_id=region.id)
    off = Country(name=f"Payoff {tag()}", region_id=region.id)
    db.add_all([home, off])
    db.flush()
    finance = add_user(db, Role.finance)
    recruiter = add_user(db, Role.regional_recruiter, assigned_country_id=home.id)
    other_recruiter = add_user(db, Role.regional_recruiter)
    account = add_user(db, Role.candidate)
    partner_user = add_user(db, Role.partner)
    partner = Partner(name=f"Pay Agency {tag()}", partner_type="travel_agency", country_of_operation="Kenya", contact_name="C",
                      contact_email=f"pa-{tag()}@test.invalid", contact_phone="+1", user_id=partner_user.id)
    db.add(partner)
    db.add_all([FeePolicy(country_id=home.id, enabled=True, updated_by=finance.id), FeePolicy(country_id=off.id, enabled=False, updated_by=finance.id)])
    job = Job(title=f"Orchard {tag()}", country="X", city="Y", job_description="d", requirements="r", service_fee_gbp=1000)
    db.add(job)
    db.flush()
    first = JobPaymentStage(job_id=job.id, order=1, label="Deposit", percent=33.333, trigger_stage=CaseStage.registration_document_submission)
    second = JobPaymentStage(job_id=job.id, order=2, label="Permit", percent=33.333, trigger_stage=CaseStage.permit_application_submission)
    third = JobPaymentStage(job_id=job.id, order=3, label="Visa", percent=33.334, trigger_stage=CaseStage.visa_interview_decision)
    db.add_all([third, first, second])
    db.flush()

    def case(country: Country, stage: CaseStage, **candidate) -> Case:
        c = Candidate(full_name=f"Pay {tag()}", country_id=country.id, **candidate)
        db.add(c)
        db.flush()
        a = Application(candidate_id=c.id, job_id=job.id)
        db.add(a)
        db.flush()
        k = Case(application_id=a.id, current_stage=stage)
        db.add(k)
        db.flush()
        return k

    mine = case(home, CaseStage.permit_processing_followup, recruiter_id=recruiter.id, user_id=account.id, partner_id=partner.id,
                source=CandidateSource.partner_sourced)
    switched_off = case(off, CaseStage.departure_arrival_support)
    db.add(CasePayment(case_id=mine.id, job_payment_stage_id=first.id, amount=333.33, recorded_by=finance.id, recorded_at=datetime(2026, 10, 1)))
    db.add(CasePayment(case_id=mine.id, job_payment_stage_id=second.id, amount=333.33, recorded_by=finance.id, status=CasePaymentStatus.pending,
                       recorded_at=datetime(2026, 10, 2)))
    db.flush()
    return {k: v for k, v in locals().items() if k not in ("db", "case")}


# --- roles --------------------------------------------------------------------------


@pytest.mark.parametrize("role", list(Role))
def test_who_may_read(api, db, world, role):  # noqa: F811
    headers = h(db, add_user(db, role))
    expected = {
        "/api/v1/consultation-bookings": OPERATIONS_ROLES | FINANCE_ROLES,
        "/api/v1/finance/payments-due": FINANCE_ROLES,
        "/api/v1/users": {Role.admin, Role.director},
    }
    for path, readers in expected.items():
        assert api.get(path, headers=headers).status_code == (200 if role in readers else 403), (path, role)
    status = api.get(f"/api/v1/cases/{world['mine'].id}/payments", headers=headers).status_code
    # Unrestricted readers see it; scoped ones are refused this case; the rest by role.
    assert status == 200 if role in (Role.director, Role.admin, Role.hr, Role.operations_team, Role.operations_director, Role.finance) else 403
    assert api.get("/api/v1/payments/me").status_code == 401


def test_the_payment_readers_are_the_websites():
    assert {r.value for r in PAYMENT_READERS} == {
        "regional_recruiter", "country_supervisor", "inhouse_supervisor", "director", "admin", "hr", "operations_team",
        "operations_director", "finance", "partner",
    }


# --- payments ------------------------------------------------------------------------


def test_a_cases_payments_in_its_scope(api, db, world):  # noqa: F811
    url = f"/api/v1/cases/{world['mine'].id}/payments"
    rows = data(api.get(url, headers=h(db, world["recruiter"])))
    assert [r["status"] for r in rows] == ["pending", "collected"]  # newest first
    assert rows[1]["recorded_at"] == "2026-10-01T00:00:00.000Z" and {"amount", "job_payment_stage_id", "receipt_reference"} <= rows[0].keys()
    assert len(data(api.get(url, headers=h(db, world["partner_user"])))) == 2
    refused = api.get(url, headers=h(db, world["other_recruiter"]))
    assert (refused.status_code, refused.json()["error"]["message"]) == (403, "Forbidden.")
    missing = api.get("/api/v1/cases/nope/payments", headers=h(db, world["finance"]))
    assert (missing.status_code, missing.json()["error"]["message"]) == (404, "Case not found.")


def test_a_users_own_payments(api, db, world):  # noqa: F811
    account = world["account"]
    db.add_all([
        Payment(user_id=account.id, job_id=world["job"].id, amount=50, payment_method="stripe", created_at=datetime(2026, 9, 1)),
        Payment(user_id=account.id, job_id=world["job"].id, amount=75, payment_method="paypal", payment_status=PaymentStatus.completed,
                created_at=datetime(2026, 9, 2)),
        Payment(user_id=world["finance"].id, job_id=world["job"].id, amount=1, payment_method="stripe"),
    ])
    db.flush()
    rows = data(api.get("/api/v1/payments/me", headers=h(db, account)))
    assert [(r["amount"], r["payment_status"], r["job"]) for r in rows] == [(75, "completed", {"title": world["job"].title}), (50, "pending", {"title": world["job"].title})]


def test_consultation_bookings_newest_first(api, db, world):  # noqa: F811
    older = ConsultationBooking(email=f"a-{tag()}@test.invalid", amount=50, stripe_checkout_session_id=f"cs_{tag()}", created_at=datetime(2026, 1, 1))
    newer = ConsultationBooking(email=f"b-{tag()}@test.invalid", amount=50, stripe_checkout_session_id=f"cs_{tag()}", created_at=datetime(2026, 1, 2))
    db.add_all([older, newer])
    db.flush()
    ids = [r["id"] for r in data(api.get("/api/v1/consultation-bookings", headers=h(db, world["finance"])))]
    assert ids.index(newer.id) < ids.index(older.id)


def test_payments_due(api, db, world):  # noqa: F811
    rows = [r for r in data(api.get("/api/v1/finance/payments-due", headers=h(db, world["finance"])))
            if r["case_id"] in (world["mine"].id, world["switched_off"].id)]
    # The deposit is collected; the permit stage is reached and only pending;
    # the visa stage isn't reached yet; the other case's fee policy is off.
    assert rows == [{
        "case_id": world["mine"].id, "candidateName": world["account"].full_name, "partnerName": world["partner"].name,
        "source": "partner_sourced", "programmeTitle": world["job"].title, "job_payment_stage_id": world["second"].id,
        "label": "Permit", "amountDue": 333.33, "currentStage": "permit_processing_followup",
    }]


# --- the staff directory -----------------------------------------------------------------


def test_the_directory(api, db, world):  # noqa: F811
    inhouse = add_user(db, Role.inhouse_supervisor, supervisor_id=world["finance"].id)
    db.add(InhouseCountryAssignment(inhouse_supervisor_id=inhouse.id, country_id=world["home"].id))
    db.flush()
    hdr = h(db, add_user(db, Role.director))

    def listed(**params):
        return {r["id"]: r for r in data(api.get("/api/v1/users", params=params, headers=hdr))}

    staff = listed()
    assert {world["recruiter"].id, inhouse.id} <= staff.keys() and world["account"].id not in staff
    assert all(r["role"] not in ("candidate", "partner", "referral_agent") for r in staff.values())
    row = staff[inhouse.id]
    assert (row["supervisor"], row["assigned_countries"], row["assigned_country"]) == (
        {"id": world["finance"].id, "full_name": world["finance"].full_name}, [{"id": world["home"].id, "name": world["home"].name}], None)
    assert staff[world["recruiter"].id]["assigned_country"] == {"id": world["home"].id, "name": world["home"].name}
    # A search covers every user, candidates included; a role narrows it.
    assert world["account"].id in listed(q=world["account"].email.upper())
    assert world["account"].id not in listed(q=world["account"].email, role="finance")
    assert set(r["role"] for r in listed(role="finance").values()) == {"finance"}
    assert api.get("/api/v1/users", params={"role": "pilot"}, headers=hdr).status_code == 422
