"""Reads handover R2: partners and referral agents. Each read answers as the
website's Prisma read did (the same rows for the same caller, the same JSON
keys), except the two owner's decisions of 2026-11-02: the partner list
gives non-managers only the name, and a partner's page shows recruiters and
country supervisors only the candidates in their own scope (policy Q1)."""

import re
import secrets

import pytest

from app.api.v1.partner_agencies import PARTNER_DETAIL_READERS, PARTNER_LIST_READERS, PARTNER_MANAGER_ROLES
from app.core.config import BASE_DIR
from app.core.rbac import REFERRAL_AGENT_MANAGER_ROLES
from app.db.session import get_db
from app.main import app
from app.models.candidate import Application, Candidate
from app.models.cases import Case
from app.models.enums import CaseStage, ReferralAgentStatus, ReferralCommissionStatus, ReferralMilestone, Role
from app.models.identity import Country, Region, User
from app.models.jobs import Job
from app.models.partners import Partner
from app.models.referral import ReferralAgent, ReferralCommission, ReferralCommissionRule
from tests.test_auth import add_session, bearer, session_token

NEXT_API = BASE_DIR.parent / "vertex" / "src" / "app" / "api"
ISO_Z = re.compile(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z")
PARTNER_KEYS = {
    "id", "name", "partner_type", "country_of_operation", "business_registration_number", "contact_name", "contact_email",
    "contact_phone", "status", "mou_status", "mou_signed_at", "notes", "created_at", "updated_at", "user_id",
}
MILESTONES = {"registered", "qualified", "application_submitted", "work_permit_approved", "visa_approved", "deployed"}


@pytest.fixture
def api(db, client):
    app.dependency_overrides[get_db] = lambda: db
    yield client
    app.dependency_overrides.pop(get_db, None)


def tag() -> str:
    return secrets.token_hex(3)


def add_user(db, role: Role, **fields) -> User:
    u = User(full_name=f"Area {role.value}", email=f"area-{tag()}@test.invalid", role=role, **fields)
    db.add(u)
    db.flush()
    db.refresh(u)
    return u


def headers(db, user: User) -> dict[str, str]:
    s = add_session(db, user.id)
    return bearer(session_token(user.id, s.family_id, user.token_version))


def as_role(db, role: Role, **fields) -> dict[str, str]:
    return headers(db, add_user(db, role, **fields))


@pytest.fixture
def world(db):
    """Two countries, a partner with three candidates (one per recruiter or
    country), a referral agent with candidates and commissions, a rule."""
    region = Region(name=f"Arearegion {tag()}")
    db.add(region)
    db.flush()
    home, away = Country(name=f"Areahome {tag()}", region_id=region.id), Country(name=f"Areaaway {tag()}", region_id=region.id)
    db.add_all([home, away])
    db.flush()
    recruiter = add_user(db, Role.regional_recruiter)
    supervisor = add_user(db, Role.country_supervisor, assigned_country_id=home.id)
    account = add_user(db, Role.candidate)
    partner = Partner(name=f"Area Partner {tag()}", partner_type="travel_agency", country_of_operation="Kenya",
                      contact_name="Contact", contact_email=f"p-{tag()}@test.invalid", contact_phone="+254700000000", notes="internal")
    db.add(partner)
    db.flush()
    mine = Candidate(full_name="Mine", partner_id=partner.id, recruiter_id=recruiter.id, country_id=away.id, user_id=account.id)
    in_home = Candidate(full_name="In home", partner_id=partner.id, country_id=home.id)
    other = Candidate(full_name="Other", partner_id=partner.id, country_id=away.id)
    db.add_all([mine, in_home, other])
    agent_user = add_user(db, Role.referral_agent)
    agent = ReferralAgent(full_name="Area Agent", email=f"a-{tag()}@test.invalid", phone="+1", country=home.name, country_id=home.id,
                          status=ReferralAgentStatus.active, referral_code=f"REF{tag()}", user_id=agent_user.id)
    rival = ReferralAgent(full_name="Rival Agent", email=f"r-{tag()}@test.invalid", phone="+1", country=home.name, country_id=home.id,
                          status=ReferralAgentStatus.active, referral_code=f"RIV{tag()}")
    db.add_all([agent, rival])
    db.flush()
    referred = Candidate(full_name="Referred", referral_agent_id=agent.id, country_id=home.id)
    db.add(referred)
    db.flush()
    application = Application(candidate_id=referred.id)
    db.add(application)
    db.flush()
    db.add(Case(application_id=application.id, current_stage=CaseStage.permit_authorization_approved))
    db.add_all([
        ReferralCommission(referral_agent_id=agent.id, candidate_id=referred.id, milestone=ReferralMilestone.registered,
                           amount=10, currency="GBP", status=ReferralCommissionStatus.paid),
        ReferralCommission(referral_agent_id=agent.id, candidate_id=referred.id, milestone=ReferralMilestone.qualified,
                           amount=25, currency="GBP", status=ReferralCommissionStatus.pending),
        ReferralCommissionRule(country_id=home.id, milestone=ReferralMilestone.qualified, amount=25, currency="GBP", updated_by=recruiter.id),
        Job(title=f"Area job {tag()}", country=home.name.upper(), city="Town", job_description="A job.", requirements="None."),
    ])
    db.flush()
    return {"home": home, "away": away, "recruiter": recruiter, "supervisor": supervisor, "partner": partner,
            "mine": mine, "in_home": in_home, "other": other, "agent": agent, "agent_user": agent_user, "rival": rival}


def data(res) -> object:
    assert res.status_code == 200, res.text
    return res.json()["data"]


# --- roles -------------------------------------------------------------------


def next_roles(route: str, name: str | None = None) -> set[str]:
    src = (NEXT_API / route / "route.ts").read_text(encoding="utf-8")
    get = src[src.index("export async function GET"):]
    if name:
        return {name}
    found = re.search(r"requireRole\(user, \[(.*?)\]\)", get, re.S)
    return set(re.findall(r'"(\w+)"', found.group(1)))


def test_the_reader_roles_match_the_website():
    assert next_roles("admin/partners") == {r.value for r in PARTNER_LIST_READERS}
    assert next_roles("admin/partners/[id]") == {r.value for r in PARTNER_DETAIL_READERS}


@pytest.mark.parametrize("role", list(Role))
def test_who_may_read(api, db, world, role):
    h = as_role(db, role)
    managers = REFERRAL_AGENT_MANAGER_ROLES
    expected = {
        "/api/v1/partners": role in PARTNER_LIST_READERS,
        f"/api/v1/partners/{world['partner'].id}": role in PARTNER_DETAIL_READERS,
        "/api/v1/referral-agents": role in managers,
        f"/api/v1/referral-agents/{world['agent'].id}": role in managers,
        "/api/v1/referral-agents/countries": role in managers,
        f"/api/v1/referral-agents/countries/{world['home'].id}/summary": role in managers,
        "/api/v1/referral-agents/performance": role in managers,
        "/api/v1/referral-commission-rules": role in managers,
        "/api/v1/referral-commissions": role in managers,
    }
    for url, allowed in expected.items():
        assert api.get(url, headers=h).status_code == (200 if allowed else 403), (url, role)
    for url in ("/api/v1/referral-agent/me", "/api/v1/referral-agent/candidates", "/api/v1/referral-agent/commissions"):
        # A referral agent without a record of their own: 404, not someone else's.
        assert api.get(url, headers=h).status_code == (404 if role is Role.referral_agent else 403), (url, role)


# --- partners ----------------------------------------------------------------


@pytest.mark.parametrize("role", PARTNER_LIST_READERS)
def test_only_partner_managers_get_full_rows(api, db, world, role):
    row = next(p for p in data(api.get("/api/v1/partners", headers=as_role(db, role))) if p["id"] == world["partner"].id)
    if role in PARTNER_MANAGER_ROLES:
        assert set(row) == PARTNER_KEYS | {"_count"}
        assert row["_count"] == {"candidates": 3}
        assert ISO_Z.fullmatch(row["created_at"])
    else:
        assert row == {"id": world["partner"].id, "name": world["partner"].name, "status": "pending"}


def test_the_list_is_by_name(api, db, world):
    names = [p["name"] for p in data(api.get("/api/v1/partners", headers=as_role(db, Role.admin)))]
    assert names == sorted(names)


def partner_candidates(api, h, world) -> set[str]:
    detail = data(api.get(f"/api/v1/partners/{world['partner'].id}", headers=h))
    assert set(detail) == PARTNER_KEYS | {"candidates", "login_activated_at"}
    return {c["full_name"] for c in detail["candidates"]}


def test_a_partner_manager_sees_all_its_candidates(api, db, world):
    for role in PARTNER_MANAGER_ROLES:
        assert partner_candidates(api, as_role(db, role), world) == {"Mine", "In home", "Other"}


def test_a_recruiter_sees_only_their_own_candidates_of_a_partner(api, db, world):
    assert partner_candidates(api, headers(db, world["recruiter"]), world) == {"Mine"}


def test_a_country_supervisor_sees_only_their_countrys(api, db, world):
    assert partner_candidates(api, headers(db, world["supervisor"]), world) == {"In home"}


def test_a_partner_candidate_has_the_websites_fields(api, db, world):
    detail = data(api.get(f"/api/v1/partners/{world['partner'].id}", headers=as_role(db, Role.admin)))
    mine = next(c for c in detail["candidates"] if c["full_name"] == "Mine")
    assert set(mine) == {"id", "full_name", "lifecycle_status", "created_at", "user", "recruiter"}
    assert set(mine["user"]) == {"full_name", "email"} and mine["recruiter"] == {"id": world["recruiter"].id, "full_name": world["recruiter"].full_name}
    assert next(c for c in detail["candidates"] if c["full_name"] == "Other")["user"] is None


def test_an_unknown_partner(api, db):
    res = api.get("/api/v1/partners/nope", headers=as_role(db, Role.admin))
    assert (res.status_code, res.json()["error"]["message"]) == (404, "Partner not found.")


# --- referral agents, for directors and admins --------------------------------


def test_the_agent_list(api, db, world):
    admin = as_role(db, Role.admin)
    rows = data(api.get("/api/v1/referral-agents", headers=admin, params={"countryId": world["home"].id}))
    assert {r["full_name"] for r in rows} == {"Area Agent", "Rival Agent"}
    mine = next(r for r in rows if r["id"] == world["agent"].id)
    assert mine["countryRef"] == {"id": world["home"].id, "name": world["home"].name}
    assert mine["_count"] == {"candidates": 1, "commissions": 2}
    assert data(api.get("/api/v1/referral-agents", headers=admin, params={"countryId": world["away"].id})) == []


def test_an_agent_in_detail(api, db, world):
    detail = data(api.get(f"/api/v1/referral-agents/{world['agent'].id}", headers=as_role(db, Role.director)))
    assert [c["full_name"] for c in detail["candidates"]] == ["Referred"]
    assert set(detail["candidates"][0]) == {"id", "full_name", "lifecycle_status", "referral_duplicate_flag", "created_at"}
    assert {c["milestone"] for c in detail["commissions"]} == {"registered", "qualified"}
    assert set(detail["commissions"][0]) == {"id", "milestone", "amount", "currency", "status", "created_at", "candidate"}
    assert api.get("/api/v1/referral-agents/nope", headers=as_role(db, Role.admin)).status_code == 404


def test_the_countries_and_a_summary(api, db, world):
    admin = as_role(db, Role.admin)
    home = next(c for c in data(api.get("/api/v1/referral-agents/countries", headers=admin)) if c["id"] == world["home"].id)
    assert home == {"id": world["home"].id, "name": world["home"].name, "activeAgents": 2, "candidatesReferred": 1, "pendingCommissionTotal": 25}
    summary = data(api.get(f"/api/v1/referral-agents/countries/{world['home'].id}/summary", headers=admin))
    assert set(summary) == {"country", "agents", "milestoneCounts", "jobs", "performance", "pendingCommissionTotal"}
    assert summary["milestoneCounts"] == {m: (1 if m in ("registered", "qualified") else 0) for m in MILESTONES}
    assert len(summary["jobs"]) == 1  # matched on the country name, case-insensitively
    assert summary["pendingCommissionTotal"] == 25
    agent = next(a for a in summary["agents"] if a["id"] == world["agent"].id)
    assert agent["_count"] == {"candidates": 1}
    perf = next(p for p in summary["performance"] if p["referralAgentId"] == world["agent"].id)
    assert perf == {"referralAgentId": world["agent"].id, "referralAgentName": "Area Agent", "countryName": world["home"].name,
                    "totalReferrals": 1, "qualified": 1, "deployed": 0, "totalCommissionEarned": 35, "currency": "GBP"}
    assert api.get("/api/v1/referral-agents/countries/nope/summary", headers=admin).status_code == 404


def test_the_rules_and_commissions(api, db, world):
    admin = as_role(db, Role.admin)
    rules = data(api.get("/api/v1/referral-commission-rules", headers=admin, params={"countryId": world["home"].id}))
    assert len(rules) == 1 and rules[0]["country"] == {"id": world["home"].id, "name": world["home"].name}
    pending = data(api.get("/api/v1/referral-commissions", headers=admin, params={"agentId": world["agent"].id, "status": "pending"}))
    assert [c["milestone"] for c in pending] == ["qualified"]
    assert set(pending[0]["referral_agent"]) == {"id", "full_name", "email"}
    assert pending[0]["candidate"]["country"] == {"id": world["home"].id, "name": world["home"].name}
    assert data(api.get("/api/v1/referral-commissions", headers=admin, params={"countryId": world["away"].id, "agentId": world["agent"].id})) == []
    assert api.get("/api/v1/referral-commissions", headers=admin, params={"status": "bogus"}).status_code == 422


# --- a referral agent's own ------------------------------------------------------


def test_an_agent_sees_their_own_and_nobody_elses(api, db, world):
    h = headers(db, world["agent_user"])
    me = data(api.get("/api/v1/referral-agent/me", headers=h))
    assert me["id"] == world["agent"].id and me["referral_code"] == world["agent"].referral_code
    assert me["total_referrals"] == 1
    assert me["commission_summary"] == {"earned": 35, "pending": 25, "paid": 10, "currency": "GBP"}
    assert me["milestone_counts"] == {m: (1 if m in ("registered", "qualified") else 0) for m in MILESTONES}
    candidates = data(api.get("/api/v1/referral-agent/candidates", headers=h))
    assert [(c["full_name"], c["current_stage"]) for c in candidates] == [("Referred", "permit_authorization_approved")]
    commissions = data(api.get("/api/v1/referral-agent/commissions", headers=h))
    assert {c["referral_agent_id"] for c in commissions} == {world["agent"].id}
    assert all(set(c["candidate"]) == {"id", "full_name"} for c in commissions)
