"""Partner agencies (users and sessions step 8.4) answer as Next.js's POST
/api/admin/partners, PATCH and DELETE /api/admin/partners/[id] and POST
/api/admin/partners/[id]/provision-account and /reset-password did: the same
roles, messages, status codes and Prisma-shaped JSON, every change audited.
Plus what 8.4 adds (users-handover.md §6): unknown fields are ignored, two
requests can't both give a partner a login, and a login that is an admin is
removed only by an admin."""

import re
import secrets
import threading

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, inspect, select, text
from sqlalchemy.orm import Session

from app.api.v1 import partner_agencies as module
from app.core.audit import set_audit_actor
from app.core.config import BASE_DIR
from app.core.tokens import verify_account_setup_token
from app.db.base import SOFT_DELETE_COLUMNS
from app.db.session import engine, get_db
from app.main import app
from app.models.audit import AuditLog
from app.models.candidate import Candidate
from app.models.enums import MouStatus, PartnerStatus, PartnerType, Role
from app.models.identity import User
from app.models.partners import Partner, PartnerCandidate
from tests.mail import token
from tests.test_auth import add_session, bearer, session_token
from tests.test_db_roles import roles_provisioned  # noqa: F401  (vertex_api must exist)

ROUTES = BASE_DIR.parent / "vertex" / "src" / "app" / "api" / "admin" / "partners"
URL = "/api/v1/partners"


@pytest.fixture
def api(db, client):
    app.dependency_overrides[get_db] = lambda: db
    yield client
    app.dependency_overrides.pop(get_db, None)


def person(db, role: Role, **fields) -> tuple[User, dict[str, str]]:
    u = User(full_name=f"{role.value} {secrets.token_hex(2)}", email=f"pa-{secrets.token_hex(4)}@test.invalid", role=role, **fields)
    db.add(u)
    db.flush()
    db.refresh(u)
    s = add_session(db, u.id)
    return u, bearer(session_token(u.id, s.family_id, u.token_version))


def agency(db, **fields) -> Partner:
    p = Partner(**{
        "name": "Agency", "partner_type": PartnerType.travel_agency, "country_of_operation": "Kenya", "contact_name": "Contact Person",
        "contact_email": f"agency-{secrets.token_hex(4)}@test.invalid", "contact_phone": "+254700000000", **fields,
    })
    db.add(p)
    db.flush()
    db.refresh(p)
    return p


def new_agency(**fields) -> dict:
    return {
        "name": "New Agency", "partner_type": "manpower_supplier", "country_of_operation": "Ghana", "contact_name": "Kofi Mensah",
        "contact_email": f"new-{secrets.token_hex(4)}@test.invalid", "contact_phone": "+233200000000", **fields,
    }


@pytest.fixture
def manager(db):
    return person(db, Role.inhouse_supervisor)[1]


def error(res) -> dict:
    return res.json()["error"]


# --- the same rules as the website ----------------------------------------------


def test_the_roles_match_next_js():
    for file in ("route.ts", "[id]/route.ts", "[id]/provision-account/route.ts", "[id]/reset-password/route.ts"):
        source = (ROUTES / file).read_text(encoding="utf-8")
        roles = re.search(r"const PARTNER_MANAGER_ROLES = \[(.*?)\] as const", source).group(1)
        assert set(re.findall(r'"(\w+)"', roles)) == {r.value for r in module.PARTNER_MANAGER_ROLES}, file


@pytest.mark.parametrize("role", [r for r in Role if r not in module.PARTNER_MANAGER_ROLES])
def test_only_managers(api, db, role):
    p = agency(db)
    _, headers = person(db, role)
    calls = [
        api.post(URL, headers=headers, json=new_agency()),
        api.patch(f"{URL}/{p.id}", headers=headers, json={"name": "Renamed"}),
        api.delete(f"{URL}/{p.id}", headers=headers),
        api.post(f"{URL}/{p.id}/provision-account", headers=headers, json={}),
        api.post(f"{URL}/{p.id}/reset-password", headers=headers),
    ]
    assert [r.status_code for r in calls] == [403] * 5


def test_no_session_is_401(api):
    assert api.post(URL, json=new_agency()).status_code == 401


def test_the_row_is_shaped_as_prisma_wrote_it(api, manager):
    data = api.post(URL, headers=manager, json=new_agency()).json()["data"]
    assert set(data) == {c.key for c in inspect(Partner).columns} - SOFT_DELETE_COLUMNS
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z", data["created_at"])


# --- create ---------------------------------------------------------------------


def test_a_manager_adds_a_partner_and_it_is_audited(api, db, manager):
    res = api.post(URL, headers=manager, json=new_agency(notes="Met in Accra"))
    assert res.status_code == 201
    data = res.json()["data"]
    assert (data["name"], data["status"], data["mou_status"], data["notes"], data["user_id"]) == ("New Agency", "pending", "none", "Met in Accra", None)
    assert db.scalar(select(AuditLog).where(AuditLog.entity_type == "Partner", AuditLog.entity_id == data["id"], AuditLog.action == "create"))


def test_unknown_fields_are_ignored_not_trusted(api, db, manager):
    other, _ = person(db, Role.partner)
    data = api.post(URL, headers=manager, json=new_agency(status="active", mou_status="signed", user_id=other.id, id="cforged000000")).json()["data"]
    assert (data["status"], data["mou_status"], data["mou_signed_at"], data["user_id"]) == ("pending", "none", None, None)
    assert data["id"] != "cforged000000"


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [("name", "A", "Name is required"), ("contact_name", "", "Contact name is required"), ("contact_phone", "12", "Contact phone is required"),
     ("country_of_operation", "X", "Country of operation is required")],
)
def test_the_schemas_messages(api, manager, field, value, message):
    res = api.post(URL, headers=manager, json=new_agency(**{field: value}))
    assert res.status_code == 422
    assert message in error(res)["details"][field]


def test_a_bad_email_or_type_is_refused(api, manager):
    assert api.post(URL, headers=manager, json=new_agency(contact_email="not-an-email")).status_code == 422
    assert api.post(URL, headers=manager, json=new_agency(partner_type="bank")).status_code == 422


def test_null_is_not_a_missing_field(api, manager):
    res = api.post(URL, headers=manager, json=new_agency(notes=None))
    assert (res.status_code, list(error(res)["details"])) == (422, ["notes"])


# --- update ---------------------------------------------------------------------


def test_fields_change_and_signing_the_mou_stamps_it(api, db, manager):
    p = agency(db, notes="old")
    res = api.patch(f"{URL}/{p.id}", headers=manager, json={"name": "Renamed", "status": "active", "mou_status": "signed", "notes": None})
    assert res.status_code == 200
    data = res.json()["data"]
    assert (data["name"], data["status"], data["mou_status"], data["notes"]) == ("Renamed", "active", "signed", None)
    assert data["mou_signed_at"] is not None
    assert res.json()["notify"] == []

    stamped = data["mou_signed_at"]
    again = api.patch(f"{URL}/{p.id}", headers=manager, json={"mou_status": "signed"}).json()["data"]
    assert again["mou_signed_at"] == stamped  # already signed: not re-stamped


def test_only_the_registration_number_and_notes_can_be_cleared(api, db, manager):
    p = agency(db, business_registration_number="BRN-1")
    assert api.patch(f"{URL}/{p.id}", headers=manager, json={"business_registration_number": None}).json()["data"]["business_registration_number"] is None
    res = api.patch(f"{URL}/{p.id}", headers=manager, json={"name": None})
    assert (res.status_code, list(error(res)["details"])) == (422, ["name"])


def test_a_new_contact_email_moves_the_login_and_ends_its_password(api, db, manager, sent_mail):
    login, _ = person(db, Role.partner, password_hash="$2b$04$somethinghashed")
    p = agency(db, user_id=login.id)
    version = login.token_version
    new = f"moved-{secrets.token_hex(4)}@test.invalid"
    res = api.patch(f"{URL}/{p.id}", headers=manager, json={"contact_email": new})
    assert res.status_code == 200
    db.refresh(login)
    assert (login.email, login.password_hash) == (new, None)
    assert login.token_version > version  # its sessions ended
    assert res.json()["notify"] == []  # FastAPI sends it (reads handover R7b)
    [mail] = sent_mail
    assert (mail.kind, mail.to) == ("account_setup", new)
    assert verify_account_setup_token(token(mail)) == login.id


def test_a_new_contact_email_without_a_login_sends_nothing(api, db, manager):
    p = agency(db)
    res = api.patch(f"{URL}/{p.id}", headers=manager, json={"contact_email": f"x-{secrets.token_hex(4)}@test.invalid"})
    assert (res.status_code, res.json()["notify"]) == (200, [])


def test_a_contact_email_another_account_uses_is_refused(api, db, manager):
    login, _ = person(db, Role.partner)
    taken, _ = person(db, Role.hr)
    p = agency(db, user_id=login.id)
    res = api.patch(f"{URL}/{p.id}", headers=manager, json={"contact_email": taken.email})
    assert (res.status_code, error(res)["message"]) == (409, "A user with this email already exists.")
    db.refresh(p)
    assert p.contact_email != taken.email


def test_an_unknown_partner_is_404(api, manager):
    for res in (
        api.patch(f"{URL}/nope", headers=manager, json={"name": "Renamed"}),
        api.delete(f"{URL}/nope", headers=manager),
        api.post(f"{URL}/nope/provision-account", headers=manager, json={}),
        api.post(f"{URL}/nope/reset-password", headers=manager),
    ):
        assert (res.status_code, error(res)["message"]) == (404, "Partner not found.")


# --- delete ---------------------------------------------------------------------


def test_a_partner_with_activity_is_not_removed(api, db, manager):
    p = agency(db)
    db.add(Candidate(full_name="Sourced", partner_id=p.id))
    db.add(PartnerCandidate(partner_id=p.id, full_name="Submitted"))
    db.flush()
    res = api.delete(f"{URL}/{p.id}", headers=manager)
    assert res.status_code == 409
    assert (error(res)["code"], error(res)["message"]) == (
        "has_activity", "This partner has 2 candidate submission(s) on file — remove or reassign them first.",
    )
    assert db.get(Partner, p.id) is not None


def test_a_partner_goes_with_its_login(api, db, manager):
    login, _ = person(db, Role.partner)
    p = agency(db, user_id=login.id)
    res = api.delete(f"{URL}/{p.id}", headers=manager)
    assert (res.status_code, res.json()) == (200, {"data": {"id": p.id}})
    db.expire_all()
    assert db.get(Partner, p.id) is None and db.get(User, login.id) is None


def test_a_login_made_admin_is_removed_only_by_an_admin_and_never_the_last(api, db):
    db.execute(text("UPDATE \"User\" SET role = 'director' WHERE role = 'admin'"))
    made_admin, _ = person(db, Role.admin)
    p = agency(db, user_id=made_admin.id)
    _, director = person(db, Role.director)
    res = api.delete(f"{URL}/{p.id}", headers=director)
    assert (res.status_code, error(res)["code"]) == (409, "last_admin")
    _, admin = person(db, Role.admin)
    assert api.delete(f"{URL}/{p.id}", headers=director).status_code == 403
    assert api.delete(f"{URL}/{p.id}", headers=admin).status_code == 200


# --- the partner's login ----------------------------------------------------------


def test_a_login_is_created_without_a_password(api, db, manager, sent_mail):
    p = agency(db)
    res = api.post(f"{URL}/{p.id}/provision-account", headers=manager, json={"role": "admin"})
    assert res.status_code == 201
    out = res.json()
    login = db.get(User, out["data"]["user_id"])
    assert (login.email, login.role, login.password_hash, login.email_verified, login.full_name) == (p.contact_email, Role.partner, None, False, "Contact Person")
    [mail] = sent_mail
    assert (out["notify"], mail.kind, mail.to) == ([], "account_setup", p.contact_email)
    assert "Set up your account, Contact Person." in mail.html
    assert verify_account_setup_token(token(mail)) == login.id


def test_the_login_address_can_differ_from_the_contact(api, db, manager):
    p = agency(db)
    other = f"ops-{secrets.token_hex(4)}@test.invalid"
    res = api.post(f"{URL}/{p.id}/provision-account", headers=manager, json={"email": other})
    assert db.get(User, res.json()["data"]["user_id"]).email == other
    bad = api.post(f"{URL}/{agency(db).id}/provision-account", headers=manager, json={"email": None})
    assert bad.status_code == 422


def test_one_login_per_partner_and_per_address(api, db, manager):
    login, _ = person(db, Role.partner)
    has_one = agency(db, user_id=login.id)
    res = api.post(f"{URL}/{has_one.id}/provision-account", headers=manager, json={})
    assert (res.status_code, error(res)["code"]) == (409, "already_provisioned")
    taken = agency(db, contact_email=login.email)
    res = api.post(f"{URL}/{taken.id}/provision-account", headers=manager, json={})
    assert (res.status_code, error(res)["message"]) == (409, "A user with this email already exists.")


def test_a_reset_clears_the_password_and_sends_the_setup_email(api, db, manager, sent_mail):
    login, _ = person(db, Role.partner, password_hash="$2b$04$somethinghashed")
    p = agency(db, user_id=login.id)
    res = api.post(f"{URL}/{p.id}/reset-password", headers=manager)
    assert (res.status_code, res.json()["data"]) == (200, {"email": login.email})
    db.refresh(login)
    assert login.password_hash is None
    assert (res.json()["notify"], [(m.kind, m.to) for m in sent_mail]) == ([], [("account_setup", login.email)])


def test_a_reset_needs_a_login(api, db, manager):
    res = api.post(f"{URL}/{agency(db).id}/reset-password", headers=manager)
    assert (res.status_code, error(res)["message"]) == (422, "This partner has no login yet — use Create Partner Login instead.")


def test_the_api_database_role_can_do_all_of_it(api, db, manager):
    db.execute(text("SET LOCAL ROLE vertex_api"))
    try:
        created = api.post(URL, headers=manager, json=new_agency())
        pid = created.json()["data"]["id"]
        updated = api.patch(f"{URL}/{pid}", headers=manager, json={"contact_email": f"r-{secrets.token_hex(4)}@test.invalid"})
        login = api.post(f"{URL}/{pid}/provision-account", headers=manager, json={})
        moved = api.patch(f"{URL}/{pid}", headers=manager, json={"contact_email": f"m-{secrets.token_hex(4)}@test.invalid"})
        reset = api.post(f"{URL}/{pid}/reset-password", headers=manager)
        removed = api.delete(f"{URL}/{pid}", headers=manager)
    finally:
        db.execute(text("RESET ROLE"))
    assert [r.status_code for r in (created, updated, login, moved, reset, removed)] == [201, 200, 201, 200, 200, 200]


# --- two logins at once -----------------------------------------------------------


@pytest.fixture
def committed_partner():
    with Session(engine) as s:
        set_audit_actor(s, None)
        boss = User(full_name="Race manager", email=f"race-m-{secrets.token_hex(4)}@test.invalid", role=Role.director)
        s.add(boss)
        s.flush()
        p = Partner(
            name="Race Agency", partner_type=PartnerType.other, country_of_operation="Kenya", contact_name="Race Contact",
            contact_email=f"race-{secrets.token_hex(4)}@test.invalid", contact_phone="+254700000001",
            status=PartnerStatus.active, mou_status=MouStatus.none,
        )
        s.add(p)
        s.commit()
        fam = add_session(s, boss.id)
        s.commit()
        s.refresh(boss)
        headers = bearer(session_token(boss.id, fam.family_id, boss.token_version))
        ids = (p.id, boss.id)
    yield ids, headers
    with Session(engine) as s:
        set_audit_actor(s, None)
        s.delete(s.get(Partner, ids[0]))
        for row in [s.get(User, ids[1]), *s.scalars(select(User).where(User.full_name == "Race Contact"))]:
            s.delete(row)
        s.commit()


def test_two_logins_at_once_make_one(committed_partner, monkeypatch):
    (pid, _), headers = committed_partner
    barrier = threading.Barrier(2, timeout=20)
    real = module._locked

    def both_found(db, partner_id):
        barrier.wait()  # both requests are in, neither has looked yet
        return real(db, partner_id)

    monkeypatch.setattr(module, "_locked", both_found)
    results: list[int] = []

    def provision(address: str) -> None:
        with TestClient(app) as c:
            results.append(c.post(f"{URL}/{pid}/provision-account", headers=headers, json={"email": address}).status_code)

    addresses = [f"race-{n}-{secrets.token_hex(3)}@test.invalid" for n in "ab"]
    threads = [threading.Thread(target=provision, args=(a,)) for a in addresses]
    for t in threads:
        t.start()
    for t in threads:
        t.join(30)
    assert sorted(results) == [201, 409]
    with Session(engine) as s:
        assert s.scalar(select(func.count()).select_from(User).where(User.email.in_(addresses))) == 1
