"""The admin's user pages (users and sessions step 8.3) answer as Next.js's
POST /api/admin/users, PATCH and DELETE /api/admin/users/[id] and POST
/api/admin/users/[id]/reset-password did: admins only, the same messages,
status codes and JSON, every change audited. Plus what 8.3 adds
(users-handover.md §6, #11 and #12): nobody changes their own role, the
last admin stays, also when two admins demote each other at once, and
unknown fields are ignored."""

import re
import secrets
import threading

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.api.v1 import users as module
from app.core.api import ApiError
from app.core.audit import set_audit_actor
from app.core.config import BASE_DIR
from app.core.tokens import verify_account_setup_token
from app.db.session import engine, get_db
from app.main import app
from app.models.audit import AuditLog
from app.models.candidate import Candidate
from app.models.enums import Role
from app.models.identity import Country, Region, User
from app.services.sessions import check_password
from tests.test_auth import add_session, bearer, session_token
from tests.test_db_roles import roles_provisioned  # noqa: F401  (vertex_api must exist)

NEXT = BASE_DIR.parent / "vertex" / "src"
ROUTES = NEXT / "app" / "api" / "admin" / "users"
URL = "/api/v1/users"


@pytest.fixture
def api(db, client):
    app.dependency_overrides[get_db] = lambda: db
    yield client
    app.dependency_overrides.pop(get_db, None)


def person(db, role: Role, **fields) -> tuple[User, dict[str, str]]:
    u = User(full_name=f"{role.value} {secrets.token_hex(2)}", email=f"usr-{secrets.token_hex(4)}@test.invalid", role=role, **fields)
    db.add(u)
    db.flush()
    db.refresh(u)
    s = add_session(db, u.id)
    return u, bearer(session_token(u.id, s.family_id, u.token_version))


@pytest.fixture
def world(db):
    region = Region(name=f"Usr region {secrets.token_hex(3)}")
    db.add(region)
    db.flush()
    countries = [Country(name=f"Usr {i} {secrets.token_hex(3)}", region_id=region.id) for i in range(3)]
    db.add_all(countries)
    db.flush()
    me, admin = person(db, Role.admin)
    boss, _ = person(db, Role.director)
    return {"countries": [c.id for c in countries], "me": me, "admin": admin, "boss": boss}


def error(res) -> dict:
    return res.json()["error"]


def new_staff(**fields) -> dict:
    return {"full_name": "New Staff", "email": f"new-{secrets.token_hex(4)}@test.invalid", "role": "hr", **fields}


# --- the same rules as the website ----------------------------------------------


def test_the_roles_match_next_js():
    for file, method in (("route.ts", "POST"), ("[id]/route.ts", "PATCH"), ("[id]/route.ts", "DELETE"), ("[id]/reset-password/route.ts", "POST")):
        handlers = (ROUTES / file).read_text(encoding="utf-8").split("export async function ")
        [handler] = [h for h in handlers if h.startswith(f"{method}(")]
        assert "requireAdmin(user)" in handler, (file, method)


def test_the_assignable_roles_match_the_websites_schema():
    validations = (NEXT / "lib" / "validations.ts").read_text(encoding="utf-8")
    block = re.search(r"const STAFF_ROLES = \[(.*?)\] as const", validations, re.S).group(1)
    assert set(re.findall(r'"(\w+)"', block)) == {r.value for r in module.ASSIGNABLE_ROLES}


@pytest.mark.parametrize("role", [r for r in Role if r is not Role.admin])
def test_only_admins(api, db, world, role):
    target, _ = person(db, Role.hr)
    _, headers = person(db, role)
    calls = [
        api.post(URL, headers=headers, json=new_staff()),
        api.patch(f"{URL}/{target.id}", headers=headers, json={"role": "finance"}),
        api.delete(f"{URL}/{target.id}", headers=headers),
        api.post(f"{URL}/{target.id}/reset-password", headers=headers),
    ]
    assert [r.status_code for r in calls] == [403] * 4


def test_no_session_is_401(api, world):
    assert api.post(URL, json=new_staff()).status_code == 401


# --- create ---------------------------------------------------------------------


def test_an_admin_creates_staff_and_the_setup_email_is_listed(api, db, world):
    body = new_staff(supervisor_id=world["boss"].id, assigned_country_id=world["countries"][0])
    res = api.post(URL, headers=world["admin"], json=body)
    assert res.status_code == 201
    out = res.json()
    data = out["data"]
    assert set(data) == {"id", "full_name", "email", "role", "supervisor_id", "supervisor", "assigned_country_id", "assigned_country", "assigned_countries"}
    assert (data["role"], data["supervisor"]["id"], data["assigned_country"]["id"], data["assigned_countries"]) == ("hr", world["boss"].id, world["countries"][0], [])
    [notice] = out["notify"]
    assert (notice["kind"], notice["email"], notice["full_name"]) == ("account_setup", body["email"], "New Staff")
    assert verify_account_setup_token(notice["token"]) == data["id"]
    assert out["privilege_granted"] is None
    user = db.get(User, data["id"])
    assert (user.password_hash, user.email_verified) == (None, False)
    audit = db.scalars(select(AuditLog).where(AuditLog.entity_id == user.id)).all()
    assert [(a.action, a.actor_id) for a in audit] == [("create", world["me"].id)]


def test_an_in_house_supervisor_gets_every_country(api, db, world):
    res = api.post(URL, headers=world["admin"], json=new_staff(role="inhouse_supervisor", assigned_country_ids=world["countries"][:2]))
    assert {c["id"] for c in res.json()["data"]["assigned_countries"]} == set(world["countries"][:2])
    other = api.post(URL, headers=world["admin"], json=new_staff(role="hr", assigned_country_ids=world["countries"][:2]))
    assert other.json()["data"]["assigned_countries"] == []  # only the In-House Supervisor role uses them


def test_creating_an_admin_is_reported_for_the_alert(api, world):
    res = api.post(URL, headers=world["admin"], json=new_staff(role="admin"))
    assert res.json()["privilege_granted"] == {"from": None, "to": "admin"}


def test_create_refusals(api, db, world):
    taken, _ = person(db, Role.hr)
    cand, _ = person(db, Role.candidate)
    cases = [
        (new_staff(email=taken.email), 409, "A user with this email already exists."),
        (new_staff(supervisor_id=cand.id), 422, "Supervisor must be an existing staff member."),
        (new_staff(assigned_country_id="cnosuchcountry0"), 404, "Country not found."),
        (new_staff(assigned_country_ids=[world["countries"][0], "cnosuchcountry0"]), 404, "One or more countries not found."),
    ]
    for body, status, message in cases:
        res = api.post(URL, headers=world["admin"], json=body)
        assert (res.status_code, error(res)["message"]) == (status, message), body


@pytest.mark.parametrize(
    ("change", "field"),
    [
        ({"role": "candidate"}, "role"),
        ({"role": "partner"}, "role"),
        ({"full_name": "X"}, "full_name"),
        ({"email": "nope"}, "email"),
        ({"supervisor_id": "not-a-cuid"}, "supervisor_id"),
    ],
)
def test_invalid_input_is_a_422(api, world, change, field):
    res = api.post(URL, headers=world["admin"], json=new_staff(**change))
    assert (res.status_code, error(res)["code"]) == (422, "validation_error")
    assert field in error(res)["details"]


def test_unknown_fields_are_ignored(api, db, world):
    res = api.post(URL, headers=world["admin"], json=new_staff(email_verified=True, password_hash="$2b$x", token_version=99, google_id="g"))
    user = db.get(User, res.json()["data"]["id"])
    assert (user.email_verified, user.password_hash, user.token_version, user.google_id) == (False, None, 0, None)


# --- update ---------------------------------------------------------------------


def test_an_admin_changes_role_supervisor_and_country(api, db, world):
    target, _ = person(db, Role.regional_recruiter)
    res = api.patch(f"{URL}/{target.id}", headers=world["admin"], json={"role": "country_supervisor", "supervisor_id": world["boss"].id, "assigned_country_id": world["countries"][1]})
    data = res.json()["data"]
    assert (res.status_code, data["role"], data["supervisor"]["full_name"], data["assigned_country"]["id"]) == (200, "country_supervisor", world["boss"].full_name, world["countries"][1])
    cleared = api.patch(f"{URL}/{target.id}", headers=world["admin"], json={"supervisor_id": None})
    assert (cleared.json()["data"]["supervisor_id"], cleared.json()["data"]["role"]) == (None, "country_supervisor")


def test_country_lists_are_replaced_and_a_missing_list_leaves_them(api, db, world):
    target, _ = person(db, Role.inhouse_supervisor)
    c = world["countries"]
    first = api.patch(f"{URL}/{target.id}", headers=world["admin"], json={"assigned_country_ids": [c[0], c[1]]})
    assert {x["id"] for x in first.json()["data"]["assigned_countries"]} == {c[0], c[1]}
    # Overlapping the old list: the pairs are unique, so the old rows go first.
    second = api.patch(f"{URL}/{target.id}", headers=world["admin"], json={"assigned_country_ids": [c[1], c[2]]})
    assert {x["id"] for x in second.json()["data"]["assigned_countries"]} == {c[1], c[2]}
    untouched = api.patch(f"{URL}/{target.id}", headers=world["admin"], json={"supervisor_id": world["boss"].id})
    assert {x["id"] for x in untouched.json()["data"]["assigned_countries"]} == {c[1], c[2]}
    emptied = api.patch(f"{URL}/{target.id}", headers=world["admin"], json={"assigned_country_ids": []})
    assert emptied.json()["data"]["assigned_countries"] == []
    audited = db.scalars(select(AuditLog).where(AuditLog.entity_type == "InhouseCountryAssignment", AuditLog.actor_id == world["me"].id)).all()
    assert {a.action for a in audited} == {"create", "delete"}


def test_update_refusals(api, db, world):
    target, _ = person(db, Role.hr)
    cand, _ = person(db, Role.candidate)
    cases = [
        (target.id, {"supervisor_id": target.id}, 422, "A user cannot supervise themselves."),
        (target.id, {"supervisor_id": cand.id}, 422, "Supervisor must be an existing staff member."),
        (target.id, {"assigned_country_id": "cnosuchcountry0"}, 404, "Country not found."),
        (target.id, {"assigned_country_ids": ["cnosuchcountry0"]}, 404, "One or more countries not found."),
        ("cnosuchuser0000", {"role": "hr"}, 404, "User not found."),
    ]
    for user_id, body, status, message in cases:
        res = api.patch(f"{URL}/{user_id}", headers=world["admin"], json=body)
        assert (res.status_code, error(res)["message"]) == (status, message), body


def test_promoting_to_admin_is_reported_for_the_alert(api, db, world):
    target, _ = person(db, Role.director)
    res = api.patch(f"{URL}/{target.id}", headers=world["admin"], json={"role": "admin"})
    assert res.json()["privilege_granted"] == {"from": "director", "to": "admin"}
    again = api.patch(f"{URL}/{target.id}", headers=world["admin"], json={"supervisor_id": None})
    assert again.json()["privilege_granted"] is None


def test_a_role_change_ends_the_users_sessions(api, db, world):
    target, _ = person(db, Role.hr)
    before = target.token_version
    api.patch(f"{URL}/{target.id}", headers=world["admin"], json={"role": "finance"})
    db.refresh(target)
    assert target.token_version > before


def test_nobody_changes_their_own_role(api, db, world):
    res = api.patch(f"{URL}/{world['me'].id}", headers=world["admin"], json={"role": "director"})
    assert (res.status_code, error(res)) == (400, {"code": "self_role_change", "message": "You can't change your own role."})
    same = api.patch(f"{URL}/{world['me'].id}", headers=world["admin"], json={"role": "admin", "assigned_country_id": world["countries"][0]})
    assert same.status_code == 200  # not a change


def test_another_admin_can_be_demoted(api, db, world):
    other, _ = person(db, Role.admin)
    res = api.patch(f"{URL}/{other.id}", headers=world["admin"], json={"role": "director"})
    assert (res.status_code, res.json()["data"]["role"]) == (200, "director")


def only_admin(db, keep: User) -> None:
    for u in db.scalars(select(User).where(User.role == Role.admin, User.id != keep.id)):
        u.role = Role.director
    db.flush()


def test_the_last_admin_stays(db, world):
    only_admin(db, world["me"])
    with pytest.raises(ApiError) as last:
        module._keep_an_admin(db, world["me"].id, world["me"].id)
    assert (last.value.status_code, last.value.code) == (409, "last_admin")
    with pytest.raises(ApiError) as gone:
        module._keep_an_admin(db, world["boss"].id, "someone-else")  # the caller isn't an admin (any more)
    assert gone.value.status_code == 403


# --- delete and reset -----------------------------------------------------------


def test_delete(api, db, world):
    target, _ = person(db, Role.candidate)
    db.add(Candidate(full_name="Their record", user_id=target.id))
    db.flush()
    res = api.delete(f"{URL}/{target.id}", headers=world["admin"])
    assert (res.status_code, res.json()) == (200, {"data": {"id": target.id}})
    db.expire_all()
    assert db.get(User, target.id) is None
    assert db.scalar(select(Candidate).where(Candidate.full_name == "Their record")) is None  # CASCADE, as with Prisma
    audit = db.scalars(select(AuditLog).where(AuditLog.entity_id == target.id, AuditLog.action == "delete")).all()
    assert [a.actor_id for a in audit] == [world["me"].id]
    gone = api.delete(f"{URL}/{target.id}", headers=world["admin"])
    assert (gone.status_code, error(gone)["message"]) == (404, "User not found.")
    me = api.delete(f"{URL}/{world['me'].id}", headers=world["admin"])
    assert (me.status_code, error(me)) == (400, {"code": "self_delete", "message": "You can't remove your own account."})


def test_another_admin_can_be_deleted(api, db, world):
    other, _ = person(db, Role.admin)
    assert api.delete(f"{URL}/{other.id}", headers=world["admin"]).status_code == 200


def test_an_admin_resets_a_password_to_a_temporary_one(api, db, world):
    target, _ = person(db, Role.hr)
    before = target.token_version
    res = api.post(f"{URL}/{target.id}/reset-password", headers=world["admin"])
    body = res.json()
    assert (res.status_code, body["data"], set(body)) == (200, {"id": target.id}, {"data", "temporaryPassword"})
    assert re.fullmatch(r"[A-Za-z0-9_-]{16}", body["temporaryPassword"])
    db.refresh(target)
    assert check_password(body["temporaryPassword"], target.password_hash) and target.token_version > before
    gone = api.post(f"{URL}/cnosuchuser0000/reset-password", headers=world["admin"])
    assert (gone.status_code, error(gone)["message"]) == (404, "User not found.")


def test_the_api_database_role_can_do_all_of_it(api, db, world):
    target, _ = person(db, Role.inhouse_supervisor)
    db.execute(text("SET LOCAL ROLE vertex_api"))
    try:
        created = api.post(URL, headers=world["admin"], json=new_staff(role="inhouse_supervisor", assigned_country_ids=world["countries"][:1]))
        updated = api.patch(f"{URL}/{target.id}", headers=world["admin"], json={"assigned_country_ids": world["countries"][1:]})
        reset = api.post(f"{URL}/{target.id}/reset-password", headers=world["admin"])
        removed = api.delete(f"{URL}/{created.json()['data']['id']}", headers=world["admin"])
    finally:
        db.execute(text("RESET ROLE"))
    assert [r.status_code for r in (created, updated, reset, removed)] == [201, 200, 200, 200]


# --- two admins demoting each other at once -------------------------------------


@pytest.fixture
def two_admins():
    """Two committed admins (and nobody else an admin), each signed in, on
    real connections; removed afterwards."""
    with Session(engine) as s:
        set_audit_actor(s, None)
        others = list(s.scalars(select(User).where(User.role == Role.admin)))
        for u in others:
            u.role = Role.director
        made = []
        for name in ("a", "b"):
            u = User(full_name=f"Race {name}", email=f"race-{name}-{secrets.token_hex(4)}@test.invalid", role=Role.admin)
            s.add(u)
            s.flush()
            made.append(u)
        s.commit()
        tokens = []
        for u in made:
            s.refresh(u)
            fam = add_session(s, u.id)
            tokens.append(bearer(session_token(u.id, fam.family_id, u.token_version)))
        s.commit()
        ids = [u.id for u in made]
        restore = [u.id for u in others]
    yield ids, tokens
    with Session(engine) as s:
        set_audit_actor(s, None)
        for u in s.scalars(select(User).where(User.id.in_(restore))):
            u.role = Role.admin
        s.commit()
        for u in s.scalars(select(User).where(User.id.in_(ids))):
            s.delete(u)
        s.commit()


def test_two_admins_demoting_each_other_at_once_leave_one(two_admins, monkeypatch):
    (a, b), (as_a, as_b) = two_admins
    barrier = threading.Barrier(2, timeout=20)
    real = module._keep_an_admin

    def both_checked(db, actor_id, target_id):
        barrier.wait()  # both requests are past every other check
        return real(db, actor_id, target_id)

    monkeypatch.setattr(module, "_keep_an_admin", both_checked)
    results: dict[str, int] = {}

    def demote(actor: str, headers: dict, target: str) -> None:
        with TestClient(app) as c:
            results[actor] = c.patch(f"{URL}/{target}", headers=headers, json={"role": "director"}).status_code

    threads = [threading.Thread(target=demote, args=("a", as_a, b)), threading.Thread(target=demote, args=("b", as_b, a))]
    for t in threads:
        t.start()
    for t in threads:
        t.join(30)
    assert sorted(results.values()) == [200, 409]
    with Session(engine) as s:
        assert len(s.scalars(select(User).where(User.role == Role.admin)).all()) == 1
