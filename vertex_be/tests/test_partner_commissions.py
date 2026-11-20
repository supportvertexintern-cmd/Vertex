"""The partner commission and admin-fee engine and its ledgers (Phase 6,
upstream staging): what an event records, once; what's due; approving and
paying; the rules grid; and the money the database itself refuses."""

from __future__ import annotations

import re
import secrets
from datetime import datetime
from decimal import Decimal

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.api.v1.partner_ledgers import PAYERS
from app.api.v1.partner_tracking import MANAGERS
from app.core.clock import utc_now_ms
from app.core.config import BASE_DIR
from app.db.session import get_db
from app.main import app
from app.models.candidate import Candidate
from app.models.enums import AdminFeeType, CaseStage, CommissionStatus, PartnerCommissionRuleType, PartnerStatus, PartnerType, Role
from app.models.identity import User
from app.models.jobs import Job, JobPaymentStage
from app.models.partner_tracking import AdminFee, PartnerCommission, PartnerCommissionRule
from app.models.partners import Partner
from app.services import partner_commissions as engine
from app.services.partner_flags import current_period
from tests.test_auth import add_session, bearer, session_token
from tests.test_db_roles import roles_provisioned  # noqa: F401  (vertex_api must exist)

URL = "/api/v1"
NEXT_API = BASE_DIR.parent / "vertex" / "src" / "app" / "api" / "admin"
MONTHLY = PartnerCommissionRuleType.monthly_deployment


@pytest.fixture
def api(db, client):
    app.dependency_overrides[get_db] = lambda: db
    yield client
    app.dependency_overrides.pop(get_db, None)


def person(db, role: Role) -> tuple[User, dict[str, str]]:
    u = User(full_name=f"Ledger {secrets.token_hex(2)}", email=f"pc-{secrets.token_hex(4)}@test.invalid", role=role)
    db.add(u)
    db.flush()
    db.refresh(u)
    return u, bearer(session_token(u.id, add_session(db, u.id).family_id, u.token_version))


@pytest.fixture
def world(db):
    partner = Partner(name=f"Ledger Agency {secrets.token_hex(2)}", partner_type=PartnerType.manpower_supplier, country_of_operation="Kenya",
                      contact_name="Pat", contact_email=f"pc-{secrets.token_hex(3)}@test.invalid", contact_phone="1", status=PartnerStatus.active)
    db.add(partner)
    db.flush()
    candidate = Candidate(full_name="Ledger Candidate", partner_id=partner.id)
    walk_in = Candidate(full_name="Nobody's Candidate")
    db.add_all([candidate, walk_in])
    db.flush()
    _, director = person(db, Role.director)
    _, inhouse = person(db, Role.inhouse_supervisor)
    _, va = person(db, Role.virtual_assistant)
    return {"partner": partner, "candidate": candidate, "walk_in": walk_in, "director": director, "inhouse": inhouse, "va": va}


def rows(db, model, candidate_id):
    return list(db.scalars(select(model).where(model.candidate_id == candidate_id).order_by(model.period)))


def next_roles(route: str) -> set[str]:
    src = (NEXT_API / route / "route.ts").read_text(encoding="utf-8")
    lists = [frozenset(re.findall(r'"(\w+)"', m)) for m in re.findall(r"requireRole\(user, \[(.*?)\]\)", src, re.S)]
    assert lists and len(set(lists)) == 1, route
    return set(lists[0])


def test_the_roles_match_next_js():
    for route in ("partner-commissions", "admin-fees"):
        assert next_roles(route) == {r.value for r in MANAGERS}, route
    for route in ("partner-commissions/[id]/approve", "partner-commissions/[id]/mark-paid", "partner-commission-rules"):
        assert next_roles(route) == {r.value for r in PAYERS}, route


# --- the engine --------------------------------------------------------------------


def test_six_calendar_months_from_the_deployment_month():
    assert engine.monthly_periods(datetime(2026, 10, 31)) == ["2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03"]


def test_only_a_whole_fee_on_credit_is_fully_financed(db):
    job = Job(title="Georgia", country="Georgia", city="Tbilisi", job_description="d", requirements="r", is_credit_service=True)
    db.add(job)
    db.flush()
    for percent in (0, 0, 100):
        db.add(JobPaymentStage(job_id=job.id, order=len(job.payment_stages) + 1, label=f"Stage {percent}", percent=percent,
                               trigger_stage=CaseStage.registration_document_submission))
        db.flush()
        db.refresh(job)
    assert engine.is_fully_financed(job) is True
    job.payment_stages[-1].percent = 70  # 30% financed: not exempt
    assert engine.is_fully_financed(job) is False
    job.payment_stages[-1].percent = 100
    job.is_credit_service = False
    assert engine.is_fully_financed(job) is False


def test_registration_earns_once_with_the_rules_amount(db, world):
    c = world["candidate"]
    earned = engine.partner_commissions_if_due(db, c.id, "registered")
    assert (earned.commission_type, earned.amount, earned.email) == ("registration", Decimal("10.00"), world["partner"].contact_email)
    assert engine.partner_commissions_if_due(db, c.id, "registered") is None  # recorded already: no second row, no second email
    [row] = rows(db, PartnerCommission, c.id)
    assert (row.rule_type.value, row.period, row.amount, row.status) == ("registration", "registration", Decimal("10.00"), CommissionStatus.pending)


def test_deployment_earns_six_months_and_vertex_its_six_fees(db, world):
    c = world["candidate"]
    earned = engine.partner_commissions_if_due(db, c.id, "deployed", deployed_at=datetime(2026, 11, 15))
    assert (earned.commission_type, earned.amount) == ("deployment", Decimal("40.00"))
    assert engine.admin_fees_if_due(db, c.id, "deployed", deployed_at=datetime(2026, 11, 15)) == 6
    assert [r.period for r in rows(db, PartnerCommission, c.id)] == ["2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04"]
    assert {(f.fee_type, f.amount) for f in rows(db, AdminFee, c.id)} == {(AdminFeeType.deployment_monthly, Decimal("40.00"))}
    # Deploying again, the stage re-entered a month later, records nothing:
    # the six months are earned once (shifting them would be a seventh row).
    assert engine.partner_commissions_if_due(db, c.id, "deployed", deployed_at=datetime(2026, 12, 1)) is None
    assert engine.admin_fees_if_due(db, c.id, "deployed", deployed_at=datetime(2026, 12, 1)) == 0
    assert (len(rows(db, PartnerCommission, c.id)), len(rows(db, AdminFee, c.id))) == (6, 6)


def test_a_zero_rule_settles_as_paid_and_sends_nothing(db, world):
    rule = db.scalar(select(PartnerCommissionRule).where(PartnerCommissionRule.rule_type == PartnerCommissionRuleType.registration))
    rule.amount = Decimal("0")
    db.flush()
    assert engine.partner_commissions_if_due(db, world["candidate"].id, "registered") is None
    [row] = rows(db, PartnerCommission, world["candidate"].id)
    assert (row.status, row.paid_at is not None) == (CommissionStatus.paid, True)


def test_nothing_for_a_candidate_no_partner_brought_in(db, world):
    assert engine.partner_commissions_if_due(db, world["walk_in"].id, "registered") is None
    assert engine.admin_fees_if_due(db, world["walk_in"].id, "application") == 0
    assert rows(db, PartnerCommission, world["walk_in"].id) == []


# --- the ledgers --------------------------------------------------------------------


def months_from_now(n: int) -> str:
    now = utc_now_ms()
    total = now.year * 12 + now.month - 1 + n
    return f"{total // 12}-{total % 12 + 1:02d}"


def commission(db, world, period: str, status=CommissionStatus.pending) -> PartnerCommission:
    row = PartnerCommission(partner_id=world["partner"].id, candidate_id=world["candidate"].id, rule_type=MONTHLY, period=period,
                            amount=Decimal("40"), status=status)
    db.add(row)
    db.flush()
    return row


def test_the_list_shows_what_is_due(api, db, world):
    now_row = commission(db, world, current_period(utc_now_ms()))
    ahead = commission(db, world, months_from_now(2))
    listed = api.get(f"{URL}/partner-commissions", headers=world["inhouse"], params={"partnerId": world["partner"].id}).json()["data"]
    ids = {r["id"] for r in listed}
    assert now_row.id in ids and ahead.id not in ids
    row = next(r for r in listed if r["id"] == now_row.id)
    assert (row["amount"], row["partner"]["name"], row["candidate"]["full_name"]) == (40.0, world["partner"].name, "Ledger Candidate")
    filtered = api.get(f"{URL}/partner-commissions", headers=world["inhouse"], params={"partnerId": world["partner"].id, "status": "paid,bogus"}).json()["data"]
    assert filtered == []
    assert api.get(f"{URL}/partner-commissions", headers=world["va"]).status_code == 403


def test_approving_and_paying(api, db, world, sent_mail):
    row = commission(db, world, current_period(utc_now_ms()))
    d = world["director"]
    assert api.post(f"{URL}/partner-commissions/{row.id}/mark-paid", headers=d, json={}).status_code == 422  # not approved yet
    approved = api.post(f"{URL}/partner-commissions/{row.id}/approve", headers=d)
    assert (approved.status_code, approved.json()["data"]["status"]) == (200, "approved")
    again = api.post(f"{URL}/partner-commissions/{row.id}/approve", headers=d)
    assert (again.status_code, again.json()["error"]["message"]) == (422, "Already approved — nothing to approve.")
    paid = api.post(f"{URL}/partner-commissions/{row.id}/mark-paid", headers=d, json={"payment_reference": "BANK-9"}).json()["data"]
    assert (paid["status"], paid["payment_reference"]) == ("paid", "BANK-9")
    assert [m.kind for m in sent_mail] == ["partner_commission_approved", "partner_commission_paid"]
    assert all(m.to == world["partner"].contact_email for m in sent_mail)


def test_a_month_ahead_is_neither_approved_nor_paid(api, db, world):
    ahead = commission(db, world, months_from_now(1))
    res = api.post(f"{URL}/partner-commissions/{ahead.id}/approve", headers=world["director"])
    assert (res.status_code, res.json()["error"]["code"]) == (422, "not_due")
    early = commission(db, world, months_from_now(2), CommissionStatus.approved)  # approved before the check existed
    assert api.post(f"{URL}/partner-commissions/{early.id}/mark-paid", headers=world["director"], json={}).json()["error"]["code"] == "not_due"


def test_moving_money_is_the_directors_and_admins(api, db, world):
    row = commission(db, world, current_period(utc_now_ms()))
    assert api.post(f"{URL}/partner-commissions/{row.id}/approve", headers=world["inhouse"]).status_code == 403
    assert api.get(f"{URL}/partner-commission-rules", headers=world["inhouse"]).status_code == 403


def test_the_rules_grid(api, db, world):
    d = world["director"]
    listed = {r["rule_type"]: r["amount"] for r in api.get(f"{URL}/partner-commission-rules", headers=d).json()["data"]}
    assert listed == {"registration": 10.0, "monthly_deployment": 40.0}  # migration 0023's
    set_ = api.post(f"{URL}/partner-commission-rules", headers=d, json={"rule_type": "registration", "amount": 12.5})
    assert set_.json()["data"]["amount"] == 12.5
    assert engine.partner_commissions_if_due(db, world["candidate"].id, "registered").amount == Decimal("12.50")
    for bad in ({"rule_type": "registration", "amount": -1}, {"rule_type": "bonus", "amount": 5}):
        assert api.post(f"{URL}/partner-commission-rules", headers=d, json=bad).status_code == 422


def test_the_admin_fee_list(api, db, world):
    engine.admin_fees_if_due(db, world["candidate"].id, "application")
    engine.admin_fees_if_due(db, world["candidate"].id, "deployed", deployed_at=utc_now_ms())
    fees = api.get(f"{URL}/admin-fees", headers=world["inhouse"], params={"partnerId": world["partner"].id}).json()["data"]
    assert sorted((f["fee_type"], f["period"]) for f in fees) == [("application", "application"), ("deployment_monthly", current_period(utc_now_ms()))]


# --- what the database refuses (migration 0025) --------------------------------------


def test_a_negative_amount_or_a_malformed_month_is_refused(db, world):
    for bad in (
        PartnerCommission(partner_id=world["partner"].id, candidate_id=world["candidate"].id, rule_type=PartnerCommissionRuleType.registration, period="registration", amount=Decimal("-1")),
        PartnerCommission(partner_id=world["partner"].id, candidate_id=world["candidate"].id, rule_type=MONTHLY, period="2026-13", amount=Decimal("40")),
        AdminFee(partner_id=world["partner"].id, candidate_id=world["candidate"].id, fee_type=AdminFeeType.deployment_monthly, period="next", amount=Decimal("40")),
    ):
        savepoint = db.begin_nested()
        db.add(bad)
        with pytest.raises(IntegrityError):
            db.flush()
        savepoint.rollback()


def test_a_seventh_month_is_refused(db, world):
    for n in range(6):
        commission(db, world, f"2026-{n + 1:02d}")
    savepoint = db.begin_nested()
    with pytest.raises(DBAPIError, match="at most 6 monthly deployment commissions"):
        commission(db, world, "2026-07")
    savepoint.rollback()
    assert db.scalar(text('SELECT count(*) FROM "PartnerCommission" WHERE candidate_id = :c'), {"c": world["candidate"].id}) == 6
