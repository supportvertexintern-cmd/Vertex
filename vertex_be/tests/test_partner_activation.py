"""Partner login activation and the first-time welcome (owner's requirement
2026-11-07, migration 0011): the first successful sign-in activates the login
and records when; the portal's welcome shows once; a password reset changes
neither; the agency's own status and MOU are never touched."""

from __future__ import annotations

from app.models.enums import MouStatus, PartnerStatus, PartnerType, Role
from app.models.partners import Partner
from app.services.google_signin import GoogleUser
from tests.test_auth import bearer
from tests.test_sessions import account, api, google, sign_in, svc  # noqa: F401  (fixtures)


def partner_login(db, name="ABC Recruitment Agency"):
    login = account(db, role=Role.partner)
    agency = Partner(
        name=name, partner_type=PartnerType.manpower_supplier, country_of_operation="Kenya", contact_name="ABC Contact",
        contact_email=login.email, contact_phone="N/A", status=PartnerStatus.pending, mou_status=MouStatus.none, user_id=login.id,
    )
    db.add(agency)
    db.flush()
    return login, agency


def token(res) -> str:
    assert res.status_code == 200, res.text
    return res.json()["data"]["session"]["access_token"]


def welcome(api, access_token):
    res = api.post("/api/v1/partner/welcome", headers=bearer(access_token))
    assert res.status_code == 200, res.text
    return res.json()["data"]


def test_the_first_sign_in_activates_the_login_and_records_when(api, db):
    login, agency = partner_login(db)
    assert login.activated_at is None
    token(sign_in(api, login))
    db.refresh(login)
    first = login.activated_at
    assert first is not None
    token(sign_in(api, login))
    db.refresh(login)
    assert login.activated_at == first  # a later sign-in keeps the first time


def test_the_welcome_shows_once_with_the_agency_name(api, db):
    login, _ = partner_login(db)
    access = token(sign_in(api, login))
    shown = welcome(api, access)
    assert shown["show"] is True and shown["agency_name"] == "ABC Recruitment Agency" and shown["activated_at"]
    assert welcome(api, access)["show"] is False
    # and on the next sign-in too
    assert welcome(api, token(sign_in(api, login)))["show"] is False


def test_a_password_reset_neither_deactivates_nor_brings_the_welcome_back(api, db):
    login, _ = partner_login(db)
    access = token(sign_in(api, login))
    assert welcome(api, access)["show"] is True
    db.refresh(login)
    activated, welcomed = login.activated_at, login.welcomed_at
    # What "Reset Password" does (partner_agencies.reset_password): the password
    # goes, and the sessions end with it; the partner then sets a new one.
    login.password_hash = None
    db.flush()
    db.refresh(login)
    login.password_hash = account(db, role=Role.candidate).password_hash  # the same test password
    db.flush()
    again = token(sign_in(api, login))
    db.refresh(login)
    assert (login.activated_at, login.welcomed_at) == (activated, welcomed)
    assert welcome(api, again)["show"] is False


def test_the_agency_status_and_mou_are_left_as_they_are(api, db):
    login, agency = partner_login(db)
    welcome(api, token(sign_in(api, login)))
    db.refresh(agency)
    assert (agency.status, agency.mou_status, agency.user_id) == (PartnerStatus.pending, MouStatus.none, login.id)


def test_only_partner_logins_are_activated(api, db):
    staff = account(db, role=Role.director)
    token(sign_in(api, staff))
    db.refresh(staff)
    assert staff.activated_at is None


def test_the_welcome_is_for_partners_only(api, db):
    staff = account(db, role=Role.director)
    res = api.post("/api/v1/partner/welcome", headers=bearer(token(sign_in(api, staff))))
    assert res.status_code == 403


def test_a_google_sign_in_activates_too(api, db, google):
    login, _ = partner_login(db)
    login.google_id = "google-partner-1"
    db.flush()
    google.user = GoogleUser(sub="google-partner-1", email=login.email, email_verified=True)
    res = api.post("/api/v1/auth/google", headers=svc(), json={"code": "c", "redirect_uri": "http://localhost/cb"})
    token(res)
    db.refresh(login)
    assert login.activated_at is not None


def test_staff_see_when_the_login_was_activated(api, db):
    login, agency = partner_login(db)
    director = account(db, role=Role.director)
    staff = token(sign_in(api, director))
    before = api.get(f"/api/v1/partners/{agency.id}", headers=bearer(staff)).json()["data"]
    assert before["user_id"] == login.id and before["login_activated_at"] is None
    token(sign_in(api, login))
    after = api.get(f"/api/v1/partners/{agency.id}", headers=bearer(staff)).json()["data"]
    assert after["login_activated_at"] is not None


def test_the_migration_counts_partners_who_signed_in_before_as_activated_and_welcomed(db):
    import importlib.util
    from pathlib import Path

    from sqlalchemy import text

    from app.models.audit import AuditLog

    spec = importlib.util.spec_from_file_location("m0011", Path(__file__).parents[1] / "alembic/versions/20261107_0011_partner_activation.py")
    m0011 = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m0011)

    before, _ = partner_login(db, "Signed In Before")
    never, _ = partner_login(db, "Never Signed In")
    staff = account(db, role=Role.director)
    for user in (before, staff):
        db.add(AuditLog(entity_type="Auth", entity_id=f"user:{user.id}", action="login_succeeded", actor_id=user.id, after={"method": "password"}))
    db.flush()
    db.connection().execute(text(m0011.BACKFILL))
    for user in (before, never, staff):
        db.refresh(user)
    assert before.activated_at is not None and before.welcomed_at == before.activated_at
    assert (never.activated_at, never.welcomed_at) == (None, None)
    assert staff.activated_at is None  # partners only


def test_the_first_sign_in_works_without_an_audit_actor_and_is_the_partners_own(api, db):
    from sqlalchemy import select

    from app.models.audit import AuditLog

    login, _ = partner_login(db)
    db.info.pop("audit_actor")  # as in production: sign-in uses a plain session
    token(sign_in(api, login))
    row = db.scalar(select(AuditLog).where(AuditLog.entity_type == "User", AuditLog.entity_id == login.id, AuditLog.action == "update"))
    assert row.actor_id == login.id and row.after["activated_at"] is not None
