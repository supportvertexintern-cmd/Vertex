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
