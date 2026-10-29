"""Exception writes (pipeline handover step 6.5) answer as Next.js's
POST /api/exceptions and PATCH /api/exceptions/[id] do: the same roles,
starting tiers, escalation line, access, messages and status codes."""

import re
import secrets
from datetime import datetime

import pytest
from sqlalchemy import select, text

from app.api.v1 import exceptions as module
from app.core.config import BASE_DIR, settings
from app.db.session import get_db
from app.main import app
from app.models.audit import AuditLog
from app.models.candidate import Candidate
from app.models.enums import EscalationLevel, ExceptionStatus, Role
from app.models.identity import Country, InhouseCountryAssignment, Region, User
from app.models.reporting import ExceptionCorrectiveAction, ExceptionReport
from app.services.exception_workflow import ESCALATION_LEVEL_ORDER, next_escalation_level, role_can_act_on_level
from tests.test_auth import add_session, bearer, session_token
from tests.test_db_roles import roles_provisioned  # noqa: F401  (vertex_api must exist)

WEB = BASE_DIR.parent / "vertex" / "src"
EXCEPTIONS_TS = (WEB / "app" / "api" / "exceptions" / "route.ts").read_text(encoding="utf-8")
URL = "/api/v1/exceptions"


@pytest.fixture
def api(db, client):
    app.dependency_overrides[get_db] = lambda: db
    yield client
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture(autouse=True)
def switched_on(monkeypatch):
    monkeypatch.setattr(settings, "PIPELINE_WRITES_ENABLED", True)


def person(db, role: Role, **fields) -> tuple[User, dict[str, str]]:
    u = User(full_name=f"{role.value} {secrets.token_hex(2)}", email=f"exc-{secrets.token_hex(4)}@test.invalid", role=role, **fields)
    db.add(u)
    db.flush()
    db.refresh(u)
    s = add_session(db, u.id)
    return u, bearer(session_token(u.id, s.family_id, u.token_version))


@pytest.fixture
def line(db):
    region = Region(name=f"Exc region {secrets.token_hex(3)}")
    db.add(region)
    db.flush()
    home = Country(name=f"Exc home {secrets.token_hex(3)}", region_id=region.id)
    away = Country(name=f"Exc away {secrets.token_hex(3)}", region_id=region.id)
    db.add_all([home, away])
    db.flush()
    recruiter, rec = person(db, Role.regional_recruiter, assigned_country_id=home.id)
    _, sup = person(db, Role.country_supervisor, assigned_country_id=home.id)
    _, away_sup = person(db, Role.country_supervisor, assigned_country_id=away.id)
    inhouse, inh = person(db, Role.inhouse_supervisor)
    db.add(InhouseCountryAssignment(inhouse_supervisor_id=inhouse.id, country_id=home.id))
    _, director = person(db, Role.director)
    _, hr = person(db, Role.hr)
    candidate = Candidate(full_name="About someone", recruiter_id=recruiter.id, country_id=home.id)
    elsewhere = Candidate(full_name="Not theirs", country_id=away.id)
    db.add_all([candidate, elsewhere])
    db.flush()
    return {"home": home, "away": away, "recruiter": recruiter, "rec": rec, "sup": sup, "away_sup": away_sup, "inh": inh, "director": director, "hr": hr, "candidate": candidate, "elsewhere": elsewhere}


def report(**fields) -> dict:
    return {
        "category": "documentation_data_integrity",
        "issue_statement": "Two candidates share one passport number.",
        "immediate_impact": "Both are blocked.",
        "decision_required": "Which record is genuine?",
        "decision_deadline": "2026-11-15",
    } | fields


def error(res) -> dict:
    return res.json()["error"]


# --- drift -------------------------------------------------------------------


def test_the_roles_and_tiers_match_next_js():
    staff = re.search(r"const STAFF_ROLES: Role\[\] = \[(.*?)\];", EXCEPTIONS_TS).group(1)
    assert set(re.findall(r'"(\w+)"', staff)) == {r.value for r in module.RAISERS}
    # The tiers and escalation rules are only FastAPI's since the switch (step 6.7).



def test_the_escalation_line():
    assert next_escalation_level(EscalationLevel.regional) is EscalationLevel.country
    assert next_escalation_level(EscalationLevel.management) is EscalationLevel.management
    assert role_can_act_on_level(Role.inhouse_supervisor, EscalationLevel.management)
    assert not role_can_act_on_level(Role.country_supervisor, EscalationLevel.regional)
    assert not role_can_act_on_level(Role.regional_recruiter, EscalationLevel.regional)
    assert role_can_act_on_level(Role.admin, EscalationLevel.regional)


def test_every_write_waits_for_the_switch(api, monkeypatch, line):
    monkeypatch.setattr(settings, "PIPELINE_WRITES_ENABLED", False)
    for res in (api.post(URL, headers=line["rec"], json=report()), api.patch(f"{URL}/cx", headers=line["rec"], json={"action": "escalate"})):
        assert (res.status_code, error(res)["code"]) == (503, "pipeline_not_enabled")
    assert len(module.router.routes) == 2


# --- raising -----------------------------------------------------------------


def test_a_recruiter_raises_one_about_their_candidate(api, db, line):
    owner, _ = person(db, Role.country_supervisor)
    res = api.post(URL, headers=line["rec"], json=report(
        candidate_id=line["candidate"].id,
        corrective_actions=[{"action": "Freeze both records", "owner_id": owner.id, "due_date": "2026-11-01"}],
    ))
    assert res.status_code == 201
    data = res.json()["data"]
    assert re.fullmatch(r"EXC-\d{6}", data["reference"])
    exception = db.get(ExceptionReport, data["id"])
    assert (exception.country_id, exception.escalation_level, exception.role_at_raise, exception.decision_deadline) == (
        line["home"].id, EscalationLevel.regional, Role.regional_recruiter, datetime(2026, 11, 15)
    )
    [action] = exception.corrective_actions
    assert (action.action, action.owner_id, action.due_date) == ("Freeze both records", owner.id, datetime(2026, 11, 1))
    assert db.scalars(select(AuditLog.action).where(AuditLog.entity_id == action.id)).all() == ["create"]


def test_references_follow_on(api, db, line):
    first = api.post(URL, headers=line["rec"], json=report()).json()["data"]["reference"]
    second = api.post(URL, headers=line["rec"], json=report()).json()["data"]["reference"]
    assert int(second[4:]) == int(first[4:]) + 1


def test_the_tier_and_country_come_from_who_raises_it(api, db, line):
    by_director = db.get(ExceptionReport, api.post(URL, headers=line["director"], json=report()).json()["data"]["id"])
    assert (by_director.escalation_level, by_director.country_id) == (EscalationLevel.management, None)
    by_inhouse = db.get(ExceptionReport, api.post(URL, headers=line["inh"], json=report()).json()["data"]["id"])
    assert (by_inhouse.escalation_level, by_inhouse.country_id) == (EscalationLevel.inhouse, line["home"].id)  # one country


def test_raising_is_checked(api, line):
    out = api.post(URL, headers=line["rec"], json=report(candidate_id=line["elsewhere"].id))
    assert (out.status_code, error(out)["message"]) == (403, "You don't have access to that candidate.")
    assert api.post(URL, headers=line["hr"], json=report()).status_code == 403  # not a raiser
    assert api.post(URL, headers=line["rec"], json=report(issue_statement="short")).status_code == 422
    assert api.post(URL, headers=line["rec"], json=report(decision_deadline="")).status_code == 422
    bad_owner = api.post(URL, headers=line["rec"], json=report(corrective_actions=[{"action": "x", "owner_id": "cnosuchuser00"}]))
    assert bad_owner.status_code == 422


# --- escalating and deciding -------------------------------------------------


def raised(api, line, headers=None, **fields) -> str:
    return api.post(URL, headers=headers or line["rec"], json=report(**fields)).json()["data"]["id"]


def test_it_climbs_and_is_decided_up_the_line(api, db, line):
    exception_id = raised(api, line, candidate_id=line["candidate"].id)
    up = api.patch(f"{URL}/{exception_id}", headers=line["rec"], json={"action": "escalate"})  # the raiser may
    assert up.json()["data"] == {"id": exception_id, "escalation_level": "country", "status": "open", "decision": None}
    away = api.patch(f"{URL}/{exception_id}", headers=line["away_sup"], json={"action": "escalate"})
    assert away.status_code == 403  # another country
    still_open = api.patch(f"{URL}/{exception_id}", headers=line["sup"], json={"action": "decide", "decision": "escalated", "decision_notes": "For In-House"})
    assert still_open.json()["data"] == {"id": exception_id, "escalation_level": "inhouse", "status": "open", "decision": "escalated"}
    assert api.patch(f"{URL}/{exception_id}", headers=line["sup"], json={"action": "decide", "decision": "approved"}).status_code == 200  # still in their country, tier above theirs
    closed = api.patch(f"{URL}/{exception_id}", headers=line["inh"], json={"action": "escalate"})
    assert (closed.status_code, error(closed)["code"]) == (422, "already_closed")
    assert db.get(ExceptionReport, exception_id).status is ExceptionStatus.closed


def test_who_may_act(api, db, line):
    exception_id = raised(api, line)
    _, other_recruiter = person(db, Role.regional_recruiter, assigned_country_id=line["home"].id)
    assert api.patch(f"{URL}/{exception_id}", headers=other_recruiter, json={"action": "escalate"}).status_code == 403
    assert api.patch(f"{URL}/{exception_id}", headers=line["director"], json={"action": "escalate"}).status_code == 403  # below management
    assert api.patch(f"{URL}/{exception_id}", headers=line["sup"], json={"action": "decide", "decision": "nope"}).status_code == 422
    assert api.patch(f"{URL}/cnosuch", headers=line["sup"], json={"action": "escalate"}).status_code == 404


# --- as the API's database role ---------------------------------------------


def test_the_api_database_role_can_write_them(api, db, line):
    db.execute(text("SET LOCAL ROLE vertex_api"))
    try:
        res = api.post(URL, headers=line["rec"], json=report(corrective_actions=[{"action": "Check"}]))
        up = api.patch(f"{URL}/{res.json()['data']['id']}", headers=line["rec"], json={"action": "escalate"})
    finally:
        db.execute(text("RESET ROLE"))
    assert (res.status_code, up.status_code) == (201, 200)
    assert db.scalars(select(ExceptionCorrectiveAction).where(ExceptionCorrectiveAction.exception_id == res.json()["data"]["id"])).one()
