"""Admin → Monitoring, phase 1 (owner's requirements 2026-11-07, migration
0012): User Accounts and deactivation.

Deactivating blocks every way in (password, Google, refresh, a live access
token, setup and reset links) and ends the sessions; reactivating opens it
again without bringing a partner's welcome back. Both need a reason and are
on the trail. Nobody deactivates themselves or the last active admin. Only
admins see the pages or call the routes (D1). Suspending a partner
deactivates its login; making it active again doesn't reactivate it (D2).
"""

from __future__ import annotations

import importlib.util
import secrets
from datetime import timedelta
from pathlib import Path

import pytest
from sqlalchemy import select, text

from app.api.v1 import users as users_module
from app.core.api import ApiError
from app.core.clock import utc_now_ms
from app.db.session import engine
from app.models.audit import AuditLog
from app.models.enums import Role
from app.models.identity import User
from app.services.google_signin import GoogleUser
from app.services.sessions import check_password, hash_password
from tests.mail import of, token as mailed_token
from tests.test_auth import bearer
from tests.test_partner_activation import partner_login, welcome
from tests.test_sessions import IP, PASSWORD, account, api, google, refresh, sign_in, svc  # noqa: F401  (fixtures)

USERS = "/api/v1/users"
ACCOUNTS = "/api/v1/monitoring/accounts"
REASON = "Left the company"


def named(db, name: str, **fields) -> User:
    user = account(db, **fields)
    user.full_name = name
    db.flush()
    return user


def signed_in(api, user) -> tuple[str, str]:
    """(access token, refresh token) of a fresh sign-in."""
    res = sign_in(api, user)
    assert res.status_code == 200, res.text
    session = res.json()["data"]["session"]
    return session["access_token"], session["refresh_token"]


@pytest.fixture
def admin(api, db):
    me = named(db, "Monitoring Admin", role=Role.admin)
    access, _ = signed_in(api, me)
    return me, bearer(access)


def deactivate(api, headers, user_id, reason=REASON):
    return api.post(f"{USERS}/{user_id}/deactivate", headers=headers, json={"reason": reason})


def reactivate(api, headers, user_id, reason="Back from leave"):
    return api.post(f"{USERS}/{user_id}/reactivate", headers=headers, json={"reason": reason})


def trail(where: str, **params) -> list[dict]:
    # As the test database's owner; vertex_api can't read the trail.
    with engine.connect() as conn:
        return [dict(r._mapping) for r in conn.execute(text(f'SELECT * FROM "AuditLog" WHERE {where} ORDER BY created_at'), params)]


# --- who may ---------------------------------------------------------------------


@pytest.mark.parametrize("role", [Role.director, Role.inhouse_supervisor, Role.hr, Role.partner, Role.referral_agent])
def test_only_admins_see_monitoring_or_change_an_account(api, db, role):
    caller = account(db, role=role)
    target = account(db, role=Role.hr)
    headers = bearer(signed_in(api, caller)[0])
    assert api.get(ACCOUNTS, headers=headers).status_code == 403
    assert api.get(f"{ACCOUNTS}/{target.id}", headers=headers).status_code == 403
    assert deactivate(api, headers, target.id).status_code == 403
    assert reactivate(api, headers, target.id).status_code == 403
    assert api.post(f"{USERS}/{target.id}/setup-email", headers=headers).status_code == 403
    assert api.delete(f"{USERS}/{target.id}/sessions/any", headers=headers).status_code == 403
    db.refresh(target)
    assert target.deactivated_at is None


def test_no_session_is_401(api, db):
    assert api.get(ACCOUNTS).status_code == 401


# --- deactivating ----------------------------------------------------------------


def test_deactivating_ends_every_session_and_blocks_every_way_in(api, db, admin, google):
    _, headers = admin
    user = account(db, role=Role.hr)
    user.google_id = f"google-{secrets.token_hex(3)}"
    db.flush()
    access, raw_refresh = signed_in(api, user)
    assert api.get("/api/v1/auth/sessions", headers=bearer(access)).status_code == 200

    res = deactivate(api, headers, user.id)
    assert res.status_code == 200, res.text
    state = res.json()["data"]
    assert state["deactivated_at"] and state["deactivation_reason"] == REASON and state["ended"] == 1

    # the access token it still holds, and its refresh token
    assert api.get("/api/v1/auth/sessions", headers=bearer(access)).status_code == 401
    assert refresh(api, raw_refresh).status_code == 401
    # the right password: told why; a wrong one: told nothing more than before
    right = sign_in(api, user)
    assert (right.status_code, right.json()["error"]["code"]) == (403, "account_deactivated")
    wrong = sign_in(api, user, "Wrong-Password-1")
    assert (wrong.status_code, wrong.json()["error"]["code"]) == (401, "invalid_credentials")
    # Google
    google.user = GoogleUser(sub=user.google_id, email=user.email, email_verified=True)
    by_google = api.post("/api/v1/auth/google", headers=svc(), json={"code": "c", "redirect_uri": "http://localhost/cb"})
    assert (by_google.status_code, by_google.json()["error"]["code"]) == (401, "account_deactivated")


def test_google_never_links_a_deactivated_account(api, db, admin, google):
    _, headers = admin
    user = account(db, role=Role.partner)
    assert deactivate(api, headers, user.id).status_code == 200
    google.user = GoogleUser(sub="google-unlinked", email=user.email, email_verified=True)
    res = api.post("/api/v1/auth/google", headers=svc(), json={"code": "c", "redirect_uri": "http://localhost/cb"})
    assert res.json()["error"]["code"] == "account_deactivated"
    db.refresh(user)
    assert user.google_id is None


def test_setup_and_reset_links_are_refused(api, db, admin, sent_mail):
    _, headers = admin
    # a login that never set its password: its setup email, then deactivated
    fresh = account(db, role=Role.partner, password=None, verified=False)
    assert api.post(f"{USERS}/{fresh.id}/setup-email", headers=headers).status_code == 200
    setup = mailed_token(of(sent_mail, "account_setup"))
    # a login with a password: its reset email
    known = account(db, role=Role.hr)
    assert api.post("/api/v1/accounts/forgot-password", headers=svc(), json={"email": known.email}).status_code == 200
    reset = mailed_token(of(sent_mail, "password_reset"))
    sent_mail.clear()

    for user in (fresh, known):
        assert deactivate(api, headers, user.id).status_code == 200
    assert api.get("/api/v1/accounts/setup", headers=svc(), params={"token": setup}).status_code == 403
    res = api.post("/api/v1/accounts/setup", headers=svc(), json={"setup": setup, "password": "New-Password-1"})
    assert (res.status_code, res.json()["error"]["code"]) == (403, "account_deactivated")
    res = api.post("/api/v1/accounts/reset-password", headers=svc(), json={"token": reset, "password": "New-Password-1"})
    assert (res.status_code, res.json()["error"]["code"]) == (403, "account_deactivated")
    # forgot-password answers as ever, and sends nothing
    assert api.post("/api/v1/accounts/forgot-password", headers=svc(), json={"email": known.email}).status_code == 200
    assert sent_mail == []
    db.refresh(fresh)
    db.refresh(known)
    assert fresh.password_hash is None
    assert check_password(PASSWORD, known.password_hash)


def test_staff_password_resets_wait_for_reactivation(api, db, admin):
    _, headers = admin
    user = account(db, role=Role.hr)
    assert deactivate(api, headers, user.id).status_code == 200
    res = api.post(f"{USERS}/{user.id}/reset-password", headers=headers)
    assert (res.status_code, res.json()["error"]["code"]) == (409, "account_deactivated")


def test_a_reason_is_required(api, db, admin):
    _, headers = admin
    user = account(db, role=Role.hr)
    for body in ({}, {"reason": ""}, {"reason": "  x "}, {"reason": "x" * 501}):
        assert api.post(f"{USERS}/{user.id}/deactivate", headers=headers, json=body).status_code == 422, body
    assert deactivate(api, headers, user.id).status_code == 200
    assert api.post(f"{USERS}/{user.id}/reactivate", headers=headers, json={}).status_code == 422


def test_refusals(api, db, admin):
    me, headers = admin
    res = deactivate(api, headers, me.id)
    assert (res.status_code, res.json()["error"]["code"]) == (400, "self_deactivate")
    assert deactivate(api, headers, "c" + "0" * 24).status_code == 404
    user = account(db, role=Role.hr)
    assert deactivate(api, headers, user.id).status_code == 200
    assert deactivate(api, headers, user.id).json()["error"]["code"] == "already_deactivated"
    assert reactivate(api, headers, user.id).status_code == 200
    assert reactivate(api, headers, user.id).json()["error"]["code"] == "not_deactivated"


def test_another_admin_can_be_deactivated_but_not_the_last_active_one(api, db, admin):
    me, headers = admin
    other = account(db, role=Role.admin)
    for u in db.scalars(select(User).where(User.role == Role.admin, User.id.not_in([me.id, other.id]))):
        u.role = Role.director
    db.flush()
    assert deactivate(api, headers, other.id).status_code == 200
    # me is now the only active admin: a deactivated one doesn't count
    with pytest.raises(ApiError) as last:
        users_module.keep_an_admin(db, me.id, me.id)
    assert last.value.code == "last_admin"


def test_both_are_on_the_trail_with_who_and_why(api, db, admin):
    me, headers = admin
    headers = {**headers, **svc()}  # as the website forwards the browser's address
    user = account(db, role=Role.hr)
    assert deactivate(api, headers, user.id).status_code == 200
    assert reactivate(api, headers, user.id, "Rehired").status_code == 200
    [off] = trail("action = 'account_deactivated' AND entity_id = :e", e=user.id)
    [on] = trail("action = 'account_reactivated' AND entity_id = :e", e=user.id)
    assert off["actor_id"] == me.id and off["after"]["reason"] == REASON and off["after"]["ip"] == IP
    assert on["actor_id"] == me.id and on["after"]["reason"] == "Rehired" and on["after"]["deactivation_reason"] == REASON
    # and the row's own change, under the admin's name (the test's work is
    # rolled back, so it is flushed into this transaction, not committed)
    rows = db.scalars(select(AuditLog).where(AuditLog.entity_type == "User", AuditLog.entity_id == user.id, AuditLog.action == "update")).all()
    assert any(r.actor_id == me.id and (r.after or {}).get("deactivation_reason") == REASON for r in rows)


# --- reactivating ----------------------------------------------------------------


def test_reactivating_opens_the_way_in_without_a_second_welcome(api, db, admin):
    _, headers = admin
    login, _agency = partner_login(db)
    access, _ = signed_in(api, login)
    assert welcome(api, access)["show"] is True
    db.refresh(login)
    activated, welcomed = login.activated_at, login.welcomed_at

    assert deactivate(api, headers, login.id).status_code == 200
    assert sign_in(api, login).status_code == 403
    assert reactivate(api, headers, login.id).status_code == 200

    again, _ = signed_in(api, login)
    db.refresh(login)
    assert (login.activated_at, login.welcomed_at) == (activated, welcomed)
    assert (login.deactivated_at, login.deactivated_by, login.deactivation_reason) == (None, None, None)
    assert welcome(api, again)["show"] is False


# --- suspending a partner (D2) ----------------------------------------------------


def test_suspending_a_partner_deactivates_its_login_and_activating_it_does_not_reactivate(api, db, admin):
    me, headers = admin
    login, agency = partner_login(db)
    access, _ = signed_in(api, login)
    res = api.patch(f"/api/v1/partners/{agency.id}", headers=headers, json={"status": "suspended"})
    assert res.status_code == 200, res.text
    db.refresh(login)
    assert login.deactivated_at is not None and login.deactivated_by == me.id
    assert login.deactivation_reason == "Partner agency suspended"
    assert api.post("/api/v1/partner/welcome", headers=bearer(access)).status_code == 401
    detail = api.get(f"/api/v1/partners/{agency.id}", headers=headers).json()["data"]
    assert detail["login_deactivated_at"] is not None

    assert api.patch(f"/api/v1/partners/{agency.id}", headers=headers, json={"status": "active"}).status_code == 200
    db.refresh(login)
    assert login.deactivated_at is not None
    res = api.post(f"/api/v1/partners/{agency.id}/reset-password", headers=headers)
    assert res.json()["error"]["code"] == "account_deactivated"


# --- setup email -------------------------------------------------------------------


def test_the_setup_email_goes_again_only_while_no_password_is_set(api, db, admin, sent_mail):
    _, headers = admin
    fresh = account(db, role=Role.hr, password=None, verified=False)
    res = api.post(f"{USERS}/{fresh.id}/setup-email", headers=headers)
    assert (res.status_code, res.json()["data"]["email"]) == (200, fresh.email)
    assert of(sent_mail, "account_setup").to == fresh.email
    assert api.post(f"{USERS}/{account(db, role=Role.hr).id}/setup-email", headers=headers).json()["error"]["code"] == "password_set"
    candidate = account(db, role=Role.candidate, password=None)
    assert api.post(f"{USERS}/{candidate.id}/setup-email", headers=headers).status_code == 422


# --- the User Accounts list ------------------------------------------------------------


def listed(api, headers, **params) -> dict:
    res = api.get(ACCOUNTS, headers=headers, params={"pageSize": 100, **params})
    assert res.status_code == 200, res.text
    return res.json()


def test_the_list_shows_staff_and_partner_logins_with_their_status(api, db, admin):
    me, headers = admin
    stamp = secrets.token_hex(3)
    created = api.post(USERS, headers=headers, json={"full_name": f"Made {stamp}", "email": f"m-{secrets.token_hex(4)}@test.invalid", "role": "hr"})
    assert created.status_code == 201
    made = created.json()["data"]["id"]
    login, agency = partner_login(db, "Listed Agency")
    login.full_name = f"Partner {stamp}"
    db.flush()
    signed_in(api, login)
    off = named(db, f"Off {stamp}", role=Role.finance)
    assert deactivate(api, headers, off.id).status_code == 200
    candidate = named(db, f"Candidate {stamp}", role=Role.candidate)

    rows = {r["id"]: r for r in listed(api, headers, q=stamp)["data"]}
    assert set(rows) == {made, login.id, off.id}
    assert candidate.id not in rows
    partner = rows[login.id]
    assert (partner["role"], partner["agency"], partner["agency_id"]) == ("partner", "Listed Agency", agency.id)
    assert (partner["status"], partner["password_set"]) == ("active", True)
    assert partner["last_sign_in_at"] and partner["last_sign_in_ip"] == IP and partner["active_sessions"] == 1
    assert rows[made]["status"] == "not_activated" and rows[made]["created_by"] == {"id": me.id, "full_name": "Monitoring Admin"}
    assert rows[made]["password_set"] is False and rows[made]["last_sign_in_at"] is None
    assert rows[off.id]["status"] == "deactivated" and rows[off.id]["deactivated_by"]["id"] == me.id
    assert rows[off.id]["deactivation_reason"] == REASON and rows[off.id]["active_sessions"] == 0


def test_the_filters(api, db, admin):
    _, headers = admin
    stamp = secrets.token_hex(3)
    active = named(db, f"Filter {stamp} active", role=Role.partner)
    signed_in(api, active)
    waiting = named(db, f"Filter {stamp} waiting", role=Role.hr)
    off = named(db, f"Filter {stamp} off", role=Role.hr)
    assert deactivate(api, headers, off.id).status_code == 200

    def ids(**params):
        return {r["id"] for r in listed(api, headers, q=f"Filter {stamp}", **params)["data"]}

    assert ids() == {active.id, waiting.id, off.id}
    assert ids(status="active") == {active.id}
    assert ids(status="not_activated") == {waiting.id}
    assert ids(status="deactivated") == {off.id}
    assert ids(role="hr") == {waiting.id, off.id}
    assert {r["id"] for r in listed(api, headers, q=active.email)["data"]} == {active.id}
    # created 40 days ago, never signed in: inactive for 30+ days
    waiting.created_at = utc_now_ms() - timedelta(days=40)
    db.flush()
    assert ids(inactive_days=30) == {waiting.id}
    today = utc_now_ms().date()
    assert ids(created_from=str(today)) == {active.id, off.id}
    assert ids(created_to=str(today - timedelta(days=1))) == {waiting.id}
    assert api.get(ACCOUNTS, headers=headers, params={"role": "candidate"}).status_code == 422


def test_the_list_is_paginated_and_sorted(api, db, admin):
    _, headers = admin
    stamp = secrets.token_hex(3)
    for name in ("Carol", "alice", "Bob"):
        named(db, f"Page {stamp} {name}", role=Role.hr)
    first = listed(api, headers, q=f"Page {stamp}", sort="full_name", direction="asc", pageSize=2)
    assert first["total"] == 3 and first["pageSize"] == 2
    assert [r["full_name"].split()[-1] for r in first["data"]] == ["alice", "Bob"]
    second = listed(api, headers, q=f"Page {stamp}", sort="full_name", direction="asc", pageSize=2, page=2)
    assert [r["full_name"].split()[-1] for r in second["data"]] == ["Carol"]


# --- one account -------------------------------------------------------------------


def test_the_account_shows_its_sessions_and_sign_ins_and_viewing_is_recorded(api, db, admin):
    me, headers = admin
    user = account(db, role=Role.hr)
    assert sign_in(api, user, "Wrong-Password-1").status_code == 401
    signed_in(api, user)
    res = api.get(f"{ACCOUNTS}/{user.id}", headers=headers)
    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert len(data["sessions"]) == 1 and data["active_sessions"] == 1
    latest, refused = data["sign_ins"][:2]
    assert latest["succeeded"] is True and latest["method"] == "password" and latest["ip"] == IP and latest["device"]
    assert refused["succeeded"] is False and refused["reason"] == "bad_password"
    [viewed] = trail("action = 'audit_trail_viewed' AND entity_id = :e", e=user.id)
    assert viewed["actor_id"] == me.id and viewed["after"]["view"] == "sign_in_history"

    # an admin ends that one session
    family = data["sessions"][0]["id"]
    assert api.delete(f"{USERS}/{user.id}/sessions/{family}", headers=headers).status_code == 200
    assert api.get(f"{ACCOUNTS}/{user.id}", headers=headers).json()["data"]["sessions"] == []
    assert api.delete(f"{USERS}/{user.id}/sessions/{family}", headers=headers).status_code == 404
    other = account(db, role=Role.hr)
    assert api.delete(f"{USERS}/{other.id}/sessions/{family}", headers=headers).status_code == 404


def test_a_candidate_is_not_an_account_here(api, db, admin):
    _, headers = admin
    assert api.get(f"{ACCOUNTS}/{account(db).id}", headers=headers).status_code == 404


# --- the migration --------------------------------------------------------------------


def test_the_migration_backfills_activation_and_who_created_each_account(db):
    spec = importlib.util.spec_from_file_location("m0012", Path(__file__).parents[1] / "alembic/versions/20261107_0012_account_status.py")
    m0012 = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m0012)

    maker = account(db, role=Role.admin)
    signed = account(db, role=Role.director)
    never = account(db, role=Role.hr)
    db.add(AuditLog(entity_type="Auth", entity_id=f"user:{signed.id}", action="login_succeeded", actor_id=signed.id, after={"method": "password"}))
    db.add(AuditLog(entity_type="User", entity_id=never.id, action="create", actor_id=maker.id, after={}))
    db.flush()
    for user in (signed, never):
        user.activated_at = None
        user.created_by = None
    db.flush()
    db.execute(text(m0012.ACTIVATED))
    db.execute(text(m0012.CREATED_BY))
    db.expire_all()
    assert db.get(User, signed.id).activated_at is not None
    assert db.get(User, never.id).activated_at is None
    assert db.get(User, never.id).created_by == maker.id


def test_a_deactivated_account_with_a_new_password_still_cannot_sign_in(api, db, admin):
    # Belt and braces: whatever sets a password, the deactivation stands.
    _, headers = admin
    user = account(db, role=Role.hr)
    assert deactivate(api, headers, user.id).status_code == 200
    user.password_hash = hash_password("Other-Password-2")
    db.flush()
    assert sign_in(api, user, "Other-Password-2").status_code == 403
