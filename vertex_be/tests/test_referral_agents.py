"""Referral-agent targets (users and sessions step 8.1) answer as Next.js's
POST /api/admin/referral-agents/[id]/targets did: the same roles, messages,
status codes and Prisma-shaped JSON, with every change audited."""

import secrets

import pytest
from sqlalchemy import select

from app.core.config import BASE_DIR
from app.db.session import get_db
from app.main import app
from app.models.audit import AuditLog
from app.models.enums import Role
from app.models.identity import User
from app.models.referral import ReferralAgent, ReferralAgentTarget
from tests.test_auth import add_session, bearer, session_token
from tests.test_db_roles import roles_provisioned  # noqa: F401  (vertex_api must exist)

NEXT = BASE_DIR.parent / "vertex" / "src" / "app" / "api" / "admin" / "referral-agents" / "[id]" / "targets" / "route.ts"
BODY = {"period_start": "2026-11-01", "period_end": "2026-11-30", "target_referrals": 12}


@pytest.fixture
def api(db, client):
    app.dependency_overrides[get_db] = lambda: db
    yield client
    app.dependency_overrides.pop(get_db, None)


def person(db, role: Role) -> tuple[User, dict[str, str]]:
    u = User(full_name=f"{role.value} {secrets.token_hex(2)}", email=f"ra-{secrets.token_hex(4)}@test.invalid", role=role)
    db.add(u)
    db.flush()
    db.refresh(u)
    s = add_session(db, u.id)
    return u, bearer(session_token(u.id, s.family_id, u.token_version))


@pytest.fixture
def agent(db):
    row = ReferralAgent(full_name="Amina Agent", email=f"agent-{secrets.token_hex(3)}@test.invalid", phone="1", country="Kenya", referral_code=f"R{secrets.token_hex(4)}")
    db.add(row)
    db.flush()
    return row


def url(agent_id: str) -> str:
    return f"/api/v1/referral-agents/{agent_id}/targets"


def test_the_roles_match_next_js():
    route = NEXT.read_text(encoding="utf-8")
    post = route[route.index("export async function POST") :]
    assert "requireRole(user, REFERRAL_AGENT_MANAGER_ROLES)" in post


@pytest.mark.parametrize("role", [Role.director, Role.admin])
def test_a_manager_sets_a_target(api, db, agent, role):
    me, headers = person(db, role)
    res = api.post(url(agent.id), headers=headers, json=BODY)
    assert res.status_code == 201
    data = res.json()["data"]
    assert set(data) == {"id", "referral_agent_id", "period_start", "period_end", "target_referrals", "set_by", "created_at", "updated_at"}
    assert (data["referral_agent_id"], data["set_by"], data["target_referrals"]) == (agent.id, me.id, 12)
    assert (data["period_start"], data["period_end"]) == ("2026-11-01T00:00:00.000Z", "2026-11-30T00:00:00.000Z")
    audit = db.scalars(select(AuditLog).where(AuditLog.entity_id == data["id"])).all()
    assert [(a.action, a.entity_type, a.actor_id) for a in audit] == [("create", "ReferralAgentTarget", me.id)]


def test_a_date_time_with_an_offset_is_stored_in_utc(api, db, agent):
    _, admin = person(db, Role.admin)
    res = api.post(url(agent.id), headers=admin, json={**BODY, "period_start": "2026-11-01T03:00:00+03:00", "target_referrals": "4"})
    assert res.status_code == 201
    assert (res.json()["data"]["period_start"], res.json()["data"]["target_referrals"]) == ("2026-11-01T00:00:00.000Z", 4)


@pytest.mark.parametrize("role", [r for r in Role if r not in (Role.director, Role.admin)])
def test_other_roles_are_refused(api, db, agent, role):
    _, headers = person(db, role)
    assert api.post(url(agent.id), headers=headers, json=BODY).status_code == 403
    assert db.scalars(select(ReferralAgentTarget).where(ReferralAgentTarget.referral_agent_id == agent.id)).all() == []


def test_no_session_is_refused(api, agent):
    assert api.post(url(agent.id), json=BODY).status_code == 401


def test_an_unknown_agent_is_404(api, db):
    _, admin = person(db, Role.admin)
    res = api.post(url("cnotanagent0000"), headers=admin, json=BODY)
    assert (res.status_code, res.json()["error"]) == (404, {"code": "not_found", "message": "Referral agent not found."})


@pytest.mark.parametrize(
    ("change", "field", "message"),
    [
        ({"period_start": ""}, "period_start", "Start date is required"),
        ({"period_end": ""}, "period_end", "End date is required"),
        ({"period_end": "not a date"}, "period_end", "Invalid date"),
        ({"target_referrals": -1}, "target_referrals", None),
        ({"target_referrals": 2.5}, "target_referrals", None),
    ],
)
def test_invalid_input_is_a_422(api, db, agent, change, field, message):
    _, admin = person(db, Role.admin)
    res = api.post(url(agent.id), headers=admin, json={**BODY, **change})
    error = res.json()["error"]
    assert (res.status_code, error["code"], error["message"]) == (422, "validation_error", "Validation failed")
    assert field in error["details"]
    if message:
        assert error["details"][field] == [message]
