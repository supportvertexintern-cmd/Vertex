"""Referral agents themselves (users and sessions step 8.4) answer as
Next.js's POST /api/referral-agents/register, GET
/api/referral-agents/verify-email, POST /api/admin/referral-agents/[id]/approve
and PATCH /api/admin/referral-agents/[id] did: the same roles, messages,
status codes and Prisma-shaped JSON, every change audited, links the website
signed before the switch still working. Plus what 8.4 adds
(users-handover.md §6): unknown fields are ignored and two approvals can't
both create a login."""

import re
import secrets
import threading

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, inspect, select, text
from sqlalchemy.orm import Session

from app.api.v1 import referral_agents as module
from app.core.audit import set_audit_actor
from app.core.config import BASE_DIR, settings
from app.core.tokens import sign_verification_token, verify_account_setup_token, verify_referral_agent_verification_token
from app.db.session import engine, get_db
from app.main import app
from app.models.audit import AuditLog
from app.models.enums import ReferralAgentStatus, Role
from app.models.identity import Country, Region, User
from app.models.referral import ReferralAgent
from tests.node_session_vectors import REFERRAL_AGENT_ID, REFERRAL_AGENT_VERIFICATION_TOKEN, SECRET
from tests.test_auth import add_session, bearer, session_token
from tests.test_db_roles import roles_provisioned  # noqa: F401  (vertex_api must exist)
from tests.test_service_auth import SERVICE_SECRET, service_token

ADMIN_ROUTES = BASE_DIR.parent / "vertex" / "src" / "app" / "api" / "admin" / "referral-agents" / "[id]"
URL = "/api/v1/referral-agents"


@pytest.fixture
def api(db, client, monkeypatch):
    monkeypatch.setattr(settings, "SERVICE_AUTH_SECRET", SERVICE_SECRET)
    monkeypatch.setattr(settings, "SERVICE_AUTH_SECRET_PREVIOUS", None)
    app.dependency_overrides[get_db] = lambda: db
    yield client
    app.dependency_overrides.pop(get_db, None)


def svc() -> dict[str, str]:
    return {"X-Vertex-Service": service_token()}


def person(db, role: Role) -> tuple[User, dict[str, str]]:
    u = User(full_name=f"{role.value} {secrets.token_hex(2)}", email=f"ra-{secrets.token_hex(4)}@test.invalid", role=role)
    db.add(u)
    db.flush()
    db.refresh(u)
    s = add_session(db, u.id)
    return u, bearer(session_token(u.id, s.family_id, u.token_version))


def agent(db, **fields) -> ReferralAgent:
    a = ReferralAgent(**{
        "full_name": "Agent Applicant", "email": f"agent-{secrets.token_hex(4)}@test.invalid", "phone": "+251900000000",
        "country": "Ethiopia", "referral_code": f"VTX-ETH-{secrets.token_hex(3)}", **fields,
    })
    db.add(a)
    db.flush()
    db.refresh(a)
    return a


def application(**fields) -> dict:
    return {"full_name": "Abebe Kebede", "email": f"apply-{secrets.token_hex(4)}@test.invalid", "phone": "+251911000000", "country": "Ethiopia", **fields}


@pytest.fixture
def director(db):
    return person(db, Role.director)


def error(res) -> dict:
    return res.json()["error"]


# --- the same rules as the website ----------------------------------------------


def test_the_roles_match_next_js():
    for file, method in (("approve/route.ts", "POST"), ("route.ts", "PATCH")):
        handlers = (ADMIN_ROUTES / file).read_text(encoding="utf-8").split("export async function ")
        [handler] = [h for h in handlers if h.startswith(f"{method}(")]
        assert "requireRole(user, REFERRAL_AGENT_MANAGER_ROLES)" in handler, (file, method)


@pytest.mark.parametrize("role", [r for r in Role if r not in (Role.director, Role.admin)])
def test_only_directors_and_admins_decide(api, db, role):
    a = agent(db, email_verified=True)
    _, headers = person(db, role)
    calls = [api.post(f"{URL}/{a.id}/approve", headers=headers, json={}), api.patch(f"{URL}/{a.id}", headers=headers, json={"status": "rejected", "reason": "x"})]
    assert [r.status_code for r in calls] == [403, 403]


def test_only_the_website_takes_applications_and_verifications(api, db, director):
    _, headers = director
    for headers in ({}, headers):  # nobody, or a signed-in user without the website's credential
        assert api.post(f"{URL}/apply", headers=headers, json=application()).status_code == 401
        assert api.post(f"{URL}/verify-email", headers=headers, json={"token": "x"}).status_code == 401


# --- applying -------------------------------------------------------------------


def test_an_application_is_pending_with_its_own_code_and_two_emails(api, db):
    region = Region(name=f"RA region {secrets.token_hex(3)}")
    db.add(region)
    db.flush()
    name = f"Narnia{secrets.token_hex(3)}"
    country = Country(name=name, region_id=region.id)
    db.add(country)
    db.flush()

    body = application(country=name.upper(), network_size="200", date_of_birth="1990-05-01", preferred_contact_channel="whatsapp")
    res = api.post(f"{URL}/apply", headers=svc(), json=body)
    assert res.status_code == 201
    out = res.json()
    assert set(out["data"]) == {"id", "referral_code"}
    assert re.fullmatch(r"VTX-NAR-\d{4}", out["data"]["referral_code"])
    row = db.get(ReferralAgent, out["data"]["id"])
    assert (row.status, row.email_verified, row.user_id, row.country_id, row.network_size, row.date_of_birth.isoformat()) == (
        ReferralAgentStatus.pending_approval, False, None, country.id, 200, "1990-05-01T00:00:00",
    )
    first, second = out["notify"]
    assert (first["kind"], first["email"], first["full_name"]) == ("referral_agent_application", body["email"], "Abebe Kebede")
    assert verify_referral_agent_verification_token(first["token"]) == row.id
    assert second == {"kind": "referral_agent_admin_notification", "full_name": "Abebe Kebede", "country": name.upper()}
    assert db.scalar(select(AuditLog).where(AuditLog.entity_type == "ReferralAgent", AuditLog.entity_id == row.id, AuditLog.action == "create"))


def test_unknown_fields_are_ignored_not_trusted(api, db):
    other, _ = person(db, Role.admin)
    body = application(status="active", email_verified=True, referral_code="VTX-OWN-0001", user_id=other.id, approved_by_id=other.id)
    out = api.post(f"{URL}/apply", headers=svc(), json=body).json()
    row = db.get(ReferralAgent, out["data"]["id"])
    assert (row.status, row.email_verified, row.user_id, row.approved_by_id) == (ReferralAgentStatus.pending_approval, False, None, None)
    assert row.referral_code != "VTX-OWN-0001"


def test_a_country_with_no_letters_still_gets_a_code(db):
    assert re.fullmatch(r"VTX-XXX-\d{4}", module.referral_code(db, "12"))
    assert re.fullmatch(r"VTX-CXX-\d{4}", module.referral_code(db, "Côte"[:1]))


def test_one_application_per_address(api, db):
    a = agent(db)
    res = api.post(f"{URL}/apply", headers=svc(), json=application(email=a.email))
    assert (res.status_code, error(res)["message"]) == (409, "An application with this email already exists.")


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [("full_name", "A", "Full name is required"), ("phone", "12", "Phone number is required"), ("country", "", "Country is required")],
)
def test_the_schemas_messages(api, field, value, message):
    res = api.post(f"{URL}/apply", headers=svc(), json=application(**{field: value}))
    assert res.status_code == 422
    assert message in error(res)["details"][field]


@pytest.mark.parametrize("fields", [{"email": "nope"}, {"network_size": -1}, {"network_size": "2.5"}, {"preferred_contact_channel": "fax"}, {"date_of_birth": "not a date"}])
def test_bad_values_are_refused(api, fields):
    assert api.post(f"{URL}/apply", headers=svc(), json=application(**fields)).status_code == 422


# --- verifying ------------------------------------------------------------------


def test_the_link_verifies_once(api, db):
    out = api.post(f"{URL}/apply", headers=svc(), json=application()).json()
    token = out["notify"][0]["token"]
    first = api.post(f"{URL}/verify-email", headers=svc(), json={"token": token})
    assert (first.status_code, first.json()["data"]) == (200, {"message": "Email verified! Our team will review your application and let you know the outcome."})
    assert db.get(ReferralAgent, out["data"]["id"]).email_verified is True
    again = api.post(f"{URL}/verify-email", headers=svc(), json={"token": token})
    assert again.json()["data"] == {"message": "Email is already verified."}


def test_a_link_the_website_signed_before_the_switch_still_works(api, db, monkeypatch):
    monkeypatch.setattr(settings, "JWT_SECRET", SECRET)
    agent(db, id=REFERRAL_AGENT_ID)
    res = api.post(f"{URL}/verify-email", headers=svc(), json={"token": REFERRAL_AGENT_VERIFICATION_TOKEN})
    assert res.status_code == 200
    assert db.get(ReferralAgent, REFERRAL_AGENT_ID).email_verified is True


@pytest.mark.parametrize(
    ("body", "status", "message"),
    [({}, 400, "Verification token is required."), ({"token": ""}, 400, "Verification token is required."),
     ({"token": "garbage"}, 400, "Invalid or expired verification token.")],
)
def test_bad_links(api, body, status, message):
    res = api.post(f"{URL}/verify-email", headers=svc(), json=body)
    assert (res.status_code, error(res)["message"]) == (status, message)


def test_a_users_verification_link_is_not_an_agents(api, db):
    a = agent(db)
    res = api.post(f"{URL}/verify-email", headers=svc(), json={"token": sign_verification_token(a.id, a.email)})
    assert res.status_code == 400
    assert db.get(ReferralAgent, a.id).email_verified is False


def test_a_link_for_a_removed_application(api, db):
    a = agent(db)
    token = module.sign_referral_agent_verification_token(a.id)
    db.delete(a)
    db.flush()
    res = api.post(f"{URL}/verify-email", headers=svc(), json={"token": token})
    assert (res.status_code, error(res)["message"]) == (404, "Referral agent application not found.")


# --- approving ------------------------------------------------------------------


def test_approval_activates_and_creates_a_login_without_a_password(api, db, director):
    boss, headers = director
    a = agent(db, email_verified=True)
    res = api.post(f"{URL}/{a.id}/approve", headers=headers, json={"role": "admin"})
    assert res.status_code == 201
    out = res.json()
    data = out["data"]
    assert set(data) == {c.key for c in inspect(ReferralAgent).columns}
    assert (data["status"], data["approved_by_id"]) == ("active", boss.id)
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z", data["approved_at"])
    login = db.get(User, data["user_id"])
    assert (login.email, login.role, login.password_hash, login.email_verified) == (a.email, Role.referral_agent, None, True)
    approved, setup = out["notify"]
    assert approved == {"kind": "referral_agent_approved", "email": a.email, "full_name": a.full_name, "referral_code": a.referral_code}
    assert (setup["kind"], setup["email"]) == ("account_setup", a.email)
    assert verify_account_setup_token(setup["token"]) == login.id


def test_the_login_address_can_differ(api, db, director):
    a = agent(db, email_verified=True)
    other = f"agent-login-{secrets.token_hex(4)}@test.invalid"
    data = api.post(f"{URL}/{a.id}/approve", headers=director[1], json={"email": other}).json()["data"]
    assert db.get(User, data["user_id"]).email == other


@pytest.mark.parametrize(
    ("fields", "status", "code"),
    [({"status": ReferralAgentStatus.active, "email_verified": True}, 409, "invalid_transition"),
     ({"email_verified": False}, 422, "email_not_verified")],
)
def test_only_a_verified_pending_application_is_approved(api, db, director, fields, status, code):
    a = agent(db, **fields)
    res = api.post(f"{URL}/{a.id}/approve", headers=director[1], json={})
    assert (res.status_code, error(res)["code"]) == (status, code)


def test_an_address_with_an_account_is_refused(api, db, director):
    taken, _ = person(db, Role.hr)
    a = agent(db, email=taken.email, email_verified=True)
    res = api.post(f"{URL}/{a.id}/approve", headers=director[1], json={})
    assert (res.status_code, error(res)["message"]) == (409, "A user with this email already exists.")
    assert db.get(ReferralAgent, a.id).status is ReferralAgentStatus.pending_approval


def test_an_unknown_agent_is_404(api, director):
    for res in (api.post(f"{URL}/nope/approve", headers=director[1], json={}), api.patch(f"{URL}/nope", headers=director[1], json={"status": "active"})):
        assert (res.status_code, error(res)["message"]) == (404, "Referral agent not found.")


# --- rejecting, suspending, reactivating ------------------------------------------


def test_reject_needs_a_pending_application_and_a_reason(api, db, director):
    a = agent(db)
    res = api.patch(f"{URL}/{a.id}", headers=director[1], json={"status": "rejected"})
    assert (res.status_code, error(res)["message"]) == (422, "A reason is required to reject an application.")
    res = api.patch(f"{URL}/{a.id}", headers=director[1], json={"status": "rejected", "reason": "No network"})
    assert res.status_code == 200
    assert (res.json()["data"]["status"], res.json()["data"]["rejection_reason"]) == ("rejected", "No network")
    assert res.json()["notify"] == [{"kind": "referral_agent_rejected", "email": a.email, "full_name": a.full_name, "reason": "No network"}]
    again = api.patch(f"{URL}/{a.id}", headers=director[1], json={"status": "rejected", "reason": "x"})
    assert (again.status_code, error(again)["message"]) == (422, "Only a pending application can be rejected.")


def test_suspend_and_reactivate(api, db, director):
    a = agent(db, status=ReferralAgentStatus.active)
    res = api.patch(f"{URL}/{a.id}", headers=director[1], json={"status": "suspended"})
    assert (res.status_code, error(res)["message"]) == (422, "A reason is required to suspend an agent.")
    res = api.patch(f"{URL}/{a.id}", headers=director[1], json={"status": "suspended", "reason": "Spam"})
    assert (res.json()["data"]["suspended_reason"], res.json()["notify"][0]["kind"]) == ("Spam", "referral_agent_suspended")
    back = api.patch(f"{URL}/{a.id}", headers=director[1], json={"status": "active", "reason": "ignored"})
    assert (back.json()["data"]["status"], back.json()["data"]["suspended_reason"], back.json()["notify"]) == ("active", None, [])
    again = api.patch(f"{URL}/{a.id}", headers=director[1], json={"status": "active"})
    assert (again.status_code, error(again)["message"]) == (422, "Only a suspended agent can be reactivated.")


def test_a_pending_application_is_not_suspended(api, db, director):
    res = api.patch(f"{URL}/{agent(db).id}", headers=director[1], json={"status": "suspended", "reason": "x"})
    assert (res.status_code, error(res)["message"]) == (422, "Only an active agent can be suspended.")


def test_an_unknown_status_is_refused(api, db, director):
    assert api.patch(f"{URL}/{agent(db).id}", headers=director[1], json={"status": "pending_approval"}).status_code == 422


def test_the_api_database_role_can_do_all_of_it(api, db, director):
    db.execute(text("SET LOCAL ROLE vertex_api"))
    try:
        applied = api.post(f"{URL}/apply", headers=svc(), json=application())
        verified = api.post(f"{URL}/verify-email", headers=svc(), json={"token": applied.json()["notify"][0]["token"]})
        aid = applied.json()["data"]["id"]
        approved = api.post(f"{URL}/{aid}/approve", headers=director[1], json={})
        suspended = api.patch(f"{URL}/{aid}", headers=director[1], json={"status": "suspended", "reason": "x"})
    finally:
        db.execute(text("RESET ROLE"))
    assert [r.status_code for r in (applied, verified, approved, suspended)] == [201, 200, 201, 200]


# --- two approvals at once --------------------------------------------------------


@pytest.fixture
def committed_agent():
    with Session(engine) as s:
        set_audit_actor(s, None)
        boss = User(full_name="Race director", email=f"race-d-{secrets.token_hex(4)}@test.invalid", role=Role.director)
        a = ReferralAgent(
            full_name="Race Agent", email=f"race-agent-{secrets.token_hex(4)}@test.invalid", phone="+251900000001",
            country="Ethiopia", referral_code=f"VTX-RAC-{secrets.token_hex(3)}", email_verified=True,
        )
        s.add_all([boss, a])
        s.commit()
        fam = add_session(s, boss.id)
        s.commit()
        s.refresh(boss)
        headers = bearer(session_token(boss.id, fam.family_id, boss.token_version))
        ids = (a.id, boss.id)
    yield ids, headers
    with Session(engine) as s:
        set_audit_actor(s, None)
        s.delete(s.get(ReferralAgent, ids[0]))
        for row in [s.get(User, ids[1]), *s.scalars(select(User).where(User.full_name == "Race Agent"))]:
            s.delete(row)
        s.commit()


def test_two_approvals_at_once_make_one_login(committed_agent, monkeypatch):
    (aid, _), headers = committed_agent
    barrier = threading.Barrier(2, timeout=20)
    real = module._locked

    def both_found(db, agent_id):
        barrier.wait()  # both requests are in, neither has looked yet
        return real(db, agent_id)

    monkeypatch.setattr(module, "_locked", both_found)
    addresses = [f"race-login-{n}-{secrets.token_hex(3)}@test.invalid" for n in "ab"]
    results: list[int] = []

    def approve(address: str) -> None:
        with TestClient(app) as c:
            results.append(c.post(f"{URL}/{aid}/approve", headers=headers, json={"email": address}).status_code)

    threads = [threading.Thread(target=approve, args=(a,)) for a in addresses]
    for t in threads:
        t.start()
    for t in threads:
        t.join(30)
    assert sorted(results) == [201, 409]
    with Session(engine) as s:
        assert s.scalar(select(func.count()).select_from(User).where(User.email.in_(addresses))) == 1
