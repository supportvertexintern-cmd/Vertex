"""Referral commission payouts (step 6.7) answer as Next.js's POST
/api/admin/referral-commissions/[id]/approve and /mark-paid did: the same
roles, states, messages and status codes, and the agent's email."""

import secrets

import pytest
from sqlalchemy import select, text

from app.core.config import BASE_DIR
from app.db.session import get_db
from app.main import app
from app.models.audit import AuditLog
from app.models.candidate import Candidate
from app.models.enums import ReferralCommissionStatus, ReferralMilestone, Role
from app.models.identity import User
from app.models.referral import ReferralAgent, ReferralCommission
from tests.test_auth import add_session, bearer, session_token
from tests.test_db_roles import roles_provisioned  # noqa: F401  (vertex_api must exist)

URL = "/api/v1/referral-commissions"
NEXT = BASE_DIR.parent / "vertex" / "src" / "app" / "api" / "admin" / "referral-commissions" / "[id]"


@pytest.fixture
def api(db, client):
    app.dependency_overrides[get_db] = lambda: db
    yield client
    app.dependency_overrides.pop(get_db, None)


def person(db, role: Role) -> tuple[User, dict[str, str]]:
    u = User(full_name=f"{role.value} {secrets.token_hex(2)}", email=f"rc-{secrets.token_hex(4)}@test.invalid", role=role)
    db.add(u)
    db.flush()
    db.refresh(u)
    s = add_session(db, u.id)
    return u, bearer(session_token(u.id, s.family_id, u.token_version))


@pytest.fixture
def commission(db):
    agent = ReferralAgent(full_name="Amina Agent", email=f"agent-{secrets.token_hex(3)}@test.invalid", phone="1", country="Kenya", referral_code=f"R{secrets.token_hex(4)}")
    db.add(agent)
    db.flush()
    candidate = Candidate(full_name="Referred Person", referral_agent_id=agent.id)
    db.add(candidate)
    db.flush()
    row = ReferralCommission(referral_agent_id=agent.id, candidate_id=candidate.id, milestone=ReferralMilestone.qualified, amount=50, currency="EUR", status=ReferralCommissionStatus.pending)
    db.add(row)
    db.flush()
    return row


def test_the_roles_match_next_js():
    for path in ("approve/route.ts", "mark-paid/route.ts"):
        assert "requireRole(user, REFERRAL_AGENT_MANAGER_ROLES)" in (NEXT / path).read_text(encoding="utf-8"), path


def test_approve_then_mark_paid(api, db, commission):
    _, director = person(db, Role.director)
    approved = api.post(f"{URL}/{commission.id}/approve", headers=director)
    assert approved.status_code == 200
    assert (approved.json()["data"]["status"], approved.json()["data"]["approved_at"] is not None) == ("approved", True)
    email = {"email": commission.referral_agent.email, "agent_name": "Amina Agent", "candidate_name": "Referred Person", "amount": 50.0, "currency": "EUR"}
    assert approved.json()["notify"] == [{"kind": "referral_commission_approved", **email}]
    again = api.post(f"{URL}/{commission.id}/approve", headers=director)
    assert (again.status_code, again.json()["error"]["message"]) == (422, "Already approved — nothing to approve.")

    paid = api.post(f"{URL}/{commission.id}/mark-paid", headers=director, json={"payment_reference": "BANK-1"})
    data = paid.json()["data"]
    assert (data["status"], data["payment_reference"], data["payment_method"]) == ("paid", "BANK-1", None)
    assert paid.json()["notify"] == [{"kind": "referral_commission_paid", **email}]
    actions = db.scalars(select(AuditLog.action).where(AuditLog.entity_id == commission.id)).all()
    assert actions.count("update") == 2


def test_paying_needs_approval_first(api, db, commission):
    _, admin = person(db, Role.admin)
    res = api.post(f"{URL}/{commission.id}/mark-paid", headers=admin, json={})
    assert (res.status_code, res.json()["error"]["message"]) == (422, "Must be approved before it can be marked paid (currently pending).")
    assert api.post(f"{URL}/cnosuch/approve", headers=admin).status_code == 404
    _, hr = person(db, Role.hr)
    assert api.post(f"{URL}/{commission.id}/approve", headers=hr).status_code == 403


def test_the_api_database_role_can_write_them(api, db, commission):
    _, director = person(db, Role.director)
    db.execute(text("SET LOCAL ROLE vertex_api"))
    try:
        res = api.post(f"{URL}/{commission.id}/approve", headers=director)
    finally:
        db.execute(text("RESET ROLE"))
    assert res.status_code == 200


# --- commission rules (payments step 7.1) -------------------------------------


@pytest.fixture
def country(db):
    from app.models.identity import Country, Region

    region = Region(name=f"Rule region {secrets.token_hex(3)}")
    db.add(region)
    db.flush()
    place = Country(name=f"Rule land {secrets.token_hex(3)}", region_id=region.id)
    db.add(place)
    db.flush()
    return place


def test_the_rule_route_matches_next_js():
    src = (BASE_DIR.parent / "vertex" / "src" / "app" / "api" / "admin" / "referral-commission-rules" / "route.ts").read_text(encoding="utf-8")
    post = src[src.index("export async function POST"):]
    assert "requireRole(user, REFERRAL_AGENT_MANAGER_ROLES)" in post


def test_a_rule_is_set_then_updated_not_duplicated(api, db, country):
    from app.models.referral import ReferralCommissionRule

    admin, as_admin = person(db, Role.admin)
    body = {"country_id": country.id, "milestone": "qualified", "amount": "25"}  # a string, as the grid sends it
    first = api.post("/api/v1/referral-commission-rules", headers=as_admin, json=body)
    assert first.status_code == 200
    assert (first.json()["data"]["amount"], first.json()["data"]["currency"], first.json()["data"]["updated_by"]) == (25.0, "USD", admin.id)
    second = api.post("/api/v1/referral-commission-rules", headers=as_admin, json=body | {"amount": 0, "currency": "EUR"})
    assert (second.json()["data"]["id"], second.json()["data"]["amount"], second.json()["data"]["currency"]) == (first.json()["data"]["id"], 0.0, "EUR")
    rows = db.scalars(select(ReferralCommissionRule).where(ReferralCommissionRule.country_id == country.id)).all()
    assert len(rows) == 1
    actions = db.scalars(select(AuditLog.action).where(AuditLog.entity_id == rows[0].id)).all()
    assert sorted(actions) == ["create", "update"]


def test_a_rule_is_checked(api, db, country):
    _, as_admin = person(db, Role.admin)
    url = "/api/v1/referral-commission-rules"
    assert api.post(url, headers=as_admin, json={"country_id": country.id, "milestone": "qualified", "amount": -1}).status_code == 422
    assert api.post(url, headers=as_admin, json={"country_id": country.id, "milestone": "hired", "amount": 1}).status_code == 422
    unknown = api.post(url, headers=as_admin, json={"country_id": "cnosuchcountry", "milestone": "qualified", "amount": 1})
    assert (unknown.status_code, unknown.json()["error"]["message"]) == (422, "Country not found.")
    _, as_hr = person(db, Role.hr)
    assert api.post(url, headers=as_hr, json={"country_id": country.id, "milestone": "qualified", "amount": 1}).status_code == 403


def test_rules_are_written_as_the_api_role(api, db, country):
    _, as_director = person(db, Role.director)
    db.execute(text("SET LOCAL ROLE vertex_api"))
    try:
        res = api.post("/api/v1/referral-commission-rules", headers=as_director, json={"country_id": country.id, "milestone": "deployed", "amount": 100})
    finally:
        db.execute(text("RESET ROLE"))
    assert res.status_code == 200
