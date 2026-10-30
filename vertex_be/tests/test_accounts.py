"""Accounts (users and sessions step 8.3) answer as Next.js's /api/auth/register,
/verify-email, /forgot-password and /reset-password did: the same messages and
status codes, the emails listed for the website to send, every write audited.
Plus what 8.3 changes (users-handover.md §6): registration in one
transaction, reset links that work once (#9), unknown fields ignored (#11),
and links that never reach the logs (#4)."""

import json
import logging
import secrets
import time
from datetime import datetime

import bcrypt
import jwt
import pytest
from sqlalchemy import select, text

from app.core.config import settings
from app.core.tokens import (
    key_for,
    password_fingerprint,
    sign_account_setup_token,
    sign_reset_token,
    sign_verification_token,
    verify_account_setup_token,
    verify_email_token,
)
from app.db.session import get_db
from app.main import app
from app.models.audit import AuditLog
from app.models.candidate import Application, Candidate
from app.models.enums import CandidateLifecycleStatus, CandidateSource, Role
from app.models.identity import Country, Region, User
from app.models.jobs import Job
from app.models.reference import DocumentRequirementType
from app.services.sessions import check_password
from tests.node_session_vectors import ACCOUNT_SETUP_TOKEN, PASSWORD_RESET_TOKEN, SECRET, VERIFICATION_TOKEN
from tests.test_db_roles import roles_provisioned  # noqa: F401  (vertex_api must exist)
from tests.test_service_auth import SERVICE_SECRET, service_token

PASSWORD = "New-Password-9"
IP = "203.0.113.9"


@pytest.fixture
def api(db, client, monkeypatch):
    monkeypatch.setattr(settings, "SERVICE_AUTH_SECRET", SERVICE_SECRET)
    monkeypatch.setattr(settings, "SERVICE_AUTH_SECRET_PREVIOUS", None)
    monkeypatch.setattr(settings, "PIPELINE_WRITES_ENABLED", True)
    app.dependency_overrides[get_db] = lambda: db
    yield client
    app.dependency_overrides.pop(get_db, None)


def svc() -> dict[str, str]:
    return {"X-Vertex-Service": service_token(), "X-Forwarded-For": IP}


def post(api, path: str, body: dict):
    return api.post(f"/api/v1/accounts/{path}", headers=svc(), json=body)


def error(res) -> dict:
    return res.json()["error"]


def events(caplog, action):
    return [r.fields for r in caplog.records if getattr(r, "event", None) == f"security.{action}"]


def account(db, *, password: str | None = "Old-Password-1", verified=True, role=Role.candidate, **fields) -> User:
    u = User(
        full_name="Account Test", email=f"acct-{secrets.token_hex(4)}@test.invalid", role=role, email_verified=verified,
        password_hash=bcrypt.hashpw(password.encode(), bcrypt.gensalt(4)).decode() if password else None, **fields,
    )
    db.add(u)
    db.flush()
    db.refresh(u)
    return u


def invite_for(candidate_id: str, *, expires_in: int = 600) -> str:
    claims = {"candidateId": candidate_id, "type": "candidate_invite", "exp": int(time.time()) + expires_in, "iss": "vertex-web", "aud": "vertex:candidate_invite"}
    return jwt.encode(claims, key_for("candidate_invite", SECRET), algorithm="HS256")


@pytest.fixture
def lead(db):
    """A screened candidate whose latest application names a country."""
    region = Region(name=f"Acct region {secrets.token_hex(3)}")
    db.add(region)
    db.flush()
    home = Country(name=f"Acct home {secrets.token_hex(3)}", region_id=region.id)
    db.add(home)
    db.flush()
    cand = Candidate(
        full_name="Abebe Kebede", email=f"lead-{secrets.token_hex(3)}@test.invalid", phone="+251911000000",
        source=CandidateSource.recruiter_sourced, lifecycle_status=CandidateLifecycleStatus.screened,
    )
    db.add(cand)
    db.flush()
    job = Job(title="Care worker", country="Germany", city="Berlin", job_description="d", requirements="r")
    db.add(job)
    db.flush()
    db.add(Application(candidate_id=cand.id, job_id=job.id, earliest_travel_date=datetime(2027, 1, 1), current_location_country_id=home.id))
    db.add(DocumentRequirementType(key=f"doc_{secrets.token_hex(3)}", label="Passport", is_universal=True))  # still to upload
    db.flush()
    cand.home = home
    return cand


# --- registration from an invite ------------------------------------------------


def test_registration_creates_the_account_and_claims_the_candidate_together(api, db, lead):
    res = post(api, "register", {"invite": invite_for(lead.id), "password": PASSWORD})
    assert res.status_code == 201
    body = res.json()
    assert body["data"]["message"] == "Account created successfully. Please check your email to verify your account."
    user = db.scalar(select(User).where(User.email == lead.email))
    assert body["data"]["user"] == {"id": user.id, "full_name": "Abebe Kebede", "email": lead.email, "role": "candidate"}
    assert (user.phone, user.country, user.email_verified) == ("+251911000000", lead.home.name, False)
    assert check_password(PASSWORD, user.password_hash) and user.password_hash.startswith("$2b$12$")
    db.refresh(lead)
    assert (lead.user_id, lead.lifecycle_status) == (user.id, CandidateLifecycleStatus.guided_to_apply)
    [notice] = body["notify"]
    assert (notice["kind"], notice["email"], notice["full_name"]) == ("email_verification", lead.email, "Abebe Kebede")
    assert verify_email_token(notice["token"], "email_verification").user_id == user.id
    audited = db.scalars(select(AuditLog).where(AuditLog.entity_id.in_([user.id, lead.id]))).all()
    assert {(a.entity_type, a.action, a.actor_id) for a in audited} >= {("User", "create", None), ("Candidate", "update", None)}
    assert all(user.password_hash not in json.dumps(a.after or {}) for a in audited)


def test_an_invite_works_once(api, db, lead):
    assert post(api, "register", {"invite": invite_for(lead.id), "password": PASSWORD}).status_code == 201
    again = post(api, "register", {"invite": invite_for(lead.id), "password": PASSWORD})
    assert (again.status_code, error(again)["message"]) == (410, "This invite has already been used or is no longer valid.")


def test_a_bad_or_expired_invite_is_400(api, lead):
    for invite in ("nope", invite_for(lead.id, expires_in=-60)):
        res = post(api, "register", {"invite": invite, "password": PASSWORD})
        assert (res.status_code, error(res)["message"]) == (400, "This invite link is invalid or has expired.")


def test_an_address_with_an_account_is_409_and_nothing_is_claimed(api, db, lead):
    taken = account(db)
    lead.email = taken.email
    db.flush()
    res = post(api, "register", {"invite": invite_for(lead.id), "password": PASSWORD})
    assert (res.status_code, error(res)["message"]) == (409, "An account with this email already exists. Please log in instead.")
    db.refresh(lead)
    assert lead.user_id is None


def test_a_failed_claim_leaves_no_account(api, db, lead, monkeypatch):
    """The account and the claim commit together: no half-made account."""
    from app.api.v1 import accounts

    def broken(*_):
        raise RuntimeError("claim failed")

    monkeypatch.setattr(accounts, "link_account", broken)
    try:
        assert post(api, "register", {"invite": invite_for(lead.id), "password": PASSWORD}).status_code == 500
    except RuntimeError:
        pass
    db.rollback()  # what closing the request's session does
    assert db.scalar(select(User).where(User.email == lead.email)) is None


def test_a_record_missing_its_name_or_email_is_422(api, db, lead):
    lead.email = None
    db.flush()
    res = post(api, "register", {"invite": invite_for(lead.id), "password": PASSWORD})
    assert (res.status_code, error(res)["message"]) == (422, "Your candidate record is missing required details. Please contact your recruiter.")


@pytest.mark.parametrize(
    ("password", "message"),
    [
        ("Short1", "Password must be at least 8 characters"),
        ("lowercase-only-1", "Password must contain at least one uppercase letter"),
        ("No-Numbers-Here", "Password must contain at least one number"),
    ],
)
def test_password_rules_match_the_website(api, lead, password, message):
    res = post(api, "register", {"invite": invite_for(lead.id), "password": password})
    assert (res.status_code, error(res)["message"], error(res)["details"]["password"]) == (422, "Validation failed", [message])
    assert password not in res.text


def test_a_missing_invite_has_the_websites_message(api):
    res = post(api, "register", {"invite": "", "password": PASSWORD})
    assert error(res)["details"]["invite"] == ["An invite link is required to create an account."]


def test_a_role_or_status_in_the_request_is_ignored(api, db, lead):
    res = post(api, "register", {"invite": invite_for(lead.id), "password": PASSWORD, "role": "admin", "email_verified": True, "email": "me@evil.invalid"})
    assert res.status_code == 201
    user = db.scalar(select(User).where(User.id == res.json()["data"]["user"]["id"]))
    assert (user.role, user.email_verified, user.email) == (Role.candidate, False, lead.email)


def test_registration_answers_only_the_website(api, lead):
    res = api.post("/api/v1/accounts/register", json={"invite": invite_for(lead.id), "password": PASSWORD})
    assert res.status_code == 401


def test_registration_waits_for_the_pipeline_switch(api, lead, monkeypatch):
    monkeypatch.setattr(settings, "PIPELINE_WRITES_ENABLED", False)
    assert post(api, "register", {"invite": invite_for(lead.id), "password": PASSWORD}).status_code == 503


# --- a staff or partner account's first password --------------------------------


def test_a_setup_link_sets_the_first_password_once(api, db):
    staff = account(db, password=None, verified=False, role=Role.hr)
    res = post(api, "setup", {"setup": sign_account_setup_token(staff.id), "password": PASSWORD})
    assert res.status_code == 200
    assert res.json()["data"] == {
        "message": "Your password is set — you can now log in.",
        "user": {"id": staff.id, "full_name": staff.full_name, "email": staff.email, "role": "hr"},
    }
    db.refresh(staff)
    assert staff.email_verified and check_password(PASSWORD, staff.password_hash)
    again = post(api, "setup", {"setup": sign_account_setup_token(staff.id), "password": PASSWORD})
    assert (again.status_code, error(again)["message"]) == (410, "This invite has already been used or is no longer valid.")


def test_a_bad_setup_link_is_400_and_a_missing_one_has_its_message(api):
    bad = post(api, "setup", {"setup": "nope", "password": PASSWORD})
    assert (bad.status_code, error(bad)["message"]) == (400, "This invite link is invalid or has expired.")
    missing = post(api, "setup", {"setup": "", "password": PASSWORD})
    assert error(missing)["details"]["setup"] == ["A setup link is required."]


def test_a_setup_link_the_website_signed_still_works(api, db):
    db.add(User(id="golden-user", full_name="Golden", email="golden@test.invalid", role=Role.partner))
    db.flush()
    assert post(api, "setup", {"setup": ACCOUNT_SETUP_TOKEN, "password": PASSWORD}).status_code == 200


# --- email verification ---------------------------------------------------------


def test_verification_then_already_verified(api, db):
    user = account(db, verified=False)
    token = sign_verification_token(user.id, user.email)
    first = post(api, "verify-email", {"token": token})
    assert (first.status_code, first.json()["data"]) == (200, {"message": "Email verified successfully! You can now log in."})
    db.refresh(user)
    assert user.email_verified
    audited = db.scalars(select(AuditLog).where(AuditLog.entity_id == user.id, AuditLog.action == "update")).all()
    assert [a.actor_id for a in audited] == [user.id]
    second = post(api, "verify-email", {"token": token})
    assert second.json()["data"] == {"message": "Email is already verified."}


def test_verification_failures(api, db):
    missing = post(api, "verify-email", {})
    assert (missing.status_code, error(missing)["message"]) == (400, "Verification token is required.")
    bad = post(api, "verify-email", {"token": "nope"})
    assert (bad.status_code, error(bad)["message"]) == (400, "Invalid or expired verification token.")
    reset_link = sign_reset_token("u", "u@test.invalid", None)  # the wrong kind of link
    assert post(api, "verify-email", {"token": reset_link}).status_code == 400
    gone = post(api, "verify-email", {"token": sign_verification_token("cnosuchuser000", "x@test.invalid")})
    assert (gone.status_code, error(gone)["message"]) == (404, "User not found.")


def test_a_link_for_an_old_address_does_not_verify_the_new_one(api, db):
    user = account(db, verified=False)
    token = sign_verification_token(user.id, "old@test.invalid")
    assert post(api, "verify-email", {"token": token}).status_code == 400
    db.refresh(user)
    assert not user.email_verified


def test_a_verification_link_the_website_signed_still_works(api, db):
    db.add(User(id="golden-user", full_name="Golden", email="golden@test.invalid", email_verified=False))
    db.flush()
    assert post(api, "verify-email", {"token": VERIFICATION_TOKEN}).json()["data"]["message"].startswith("Email verified")


# --- forgot and reset password --------------------------------------------------

FORGOT = "If an account exists for that email, we've sent a password reset link."


def test_forgot_password_answers_the_same_and_emails_only_a_real_account(api, db, caplog):
    user = account(db)
    lead_only = account(db, password=None)
    with caplog.at_level(logging.INFO, logger="vertex"):
        answers = [post(api, "forgot-password", {"email": e}) for e in (user.email, lead_only.email, "nobody@test.invalid")]
    assert {(r.status_code, r.json()["data"]["message"]) for r in answers} == {(200, FORGOT)}
    assert [len(r.json()["notify"]) for r in answers] == [1, 0, 0]
    [notice] = answers[0].json()["notify"]
    assert (notice["kind"], notice["email"]) == ("password_reset", user.email)
    link = verify_email_token(notice["token"], "password_reset")
    assert (link.user_id, link.pwd) == (user.id, password_fingerprint(user.password_hash))
    requested = events(caplog, "password_reset_requested")
    assert [(e["entity_id"], e["email_sent"], e["ip"]) for e in requested] == [
        (f"user:{user.id}", True, IP), (f"user:{lead_only.id}", False, IP), ("unknown_account", False, IP),
    ]


def test_forgot_password_checks_the_address(api):
    res = post(api, "forgot-password", {"email": "not-an-email"})
    assert (res.status_code, error(res)["details"]["email"]) == (422, ["Invalid email address"])


def test_a_reset_link_sets_the_password_and_works_once(api, db, caplog):
    user = account(db)
    token = sign_reset_token(user.id, user.email, user.password_hash)
    with caplog.at_level(logging.INFO, logger="vertex"):
        res = post(api, "reset-password", {"token": token, "password": PASSWORD})
        again = post(api, "reset-password", {"token": token, "password": "Another-Pass-2"})
    assert (res.status_code, res.json()["data"]) == (200, {"message": "Password reset successfully. You can now log in."})
    db.refresh(user)
    assert check_password(PASSWORD, user.password_hash)
    assert (again.status_code, error(again)["message"]) == (400, "This reset link is invalid or has expired. Request a new one.")
    assert [e["outcome"] for e in events(caplog, "password_reset_completed")] == ["password_changed", "link_already_used"]
    audited = db.scalars(select(AuditLog).where(AuditLog.entity_id == user.id, AuditLog.action == "update")).all()
    assert [a.actor_id for a in audited] == [user.id]


def test_a_reset_link_stops_working_when_the_password_changes_another_way(api, db):
    user = account(db)
    token = sign_reset_token(user.id, user.email, user.password_hash)
    user.password_hash = bcrypt.hashpw(b"Changed-Elsewhere-3", bcrypt.gensalt(4)).decode()
    db.flush()
    assert post(api, "reset-password", {"token": token, "password": PASSWORD}).status_code == 400


def test_a_reset_ends_every_session(api, db):
    user = account(db)
    before = user.token_version
    post(api, "reset-password", {"token": sign_reset_token(user.id, user.email, user.password_hash), "password": PASSWORD})
    db.refresh(user)
    assert user.token_version > before  # the trigger: every session's next check fails


def test_reset_failures(api, db, caplog):
    with caplog.at_level(logging.INFO, logger="vertex"):
        bad = post(api, "reset-password", {"token": "nope", "password": PASSWORD})
    assert (bad.status_code, error(bad)["message"]) == (400, "This reset link is invalid or has expired. Request a new one.")
    assert events(caplog, "password_reset_completed")[0]["outcome"] == "invalid_or_expired_link"
    gone = post(api, "reset-password", {"token": sign_reset_token("cnosuchuser000", "x@test.invalid", None), "password": PASSWORD})
    assert (gone.status_code, error(gone)["message"]) == (404, "Account not found.")
    verification = sign_verification_token("u", "u@test.invalid")  # the wrong kind of link
    assert post(api, "reset-password", {"token": verification, "password": PASSWORD}).status_code == 400
    missing = post(api, "reset-password", {"token": "", "password": PASSWORD})
    assert error(missing)["details"]["token"] == ["A reset link is required."]


def test_a_reset_link_the_website_signed_still_works_until_it_expires(api, db):
    """Signed before 8.3, it names no password: valid for its 24 hours."""
    db.add(User(id="golden-user", full_name="Golden", email="golden@test.invalid", password_hash="$2b$04$x"))
    db.flush()
    assert post(api, "reset-password", {"token": PASSWORD_RESET_TOKEN, "password": PASSWORD}).status_code == 200


# --- the links themselves -------------------------------------------------------


def test_links_carry_the_claims_the_website_checks():
    """So the website accepts them if it takes the writes back."""
    for token, purpose, fields in (
        (sign_verification_token("u1", "u@test.invalid"), "email_verification", {"userId", "email", "type"}),
        (sign_reset_token("u1", "u@test.invalid", "$2b$hash"), "password_reset", {"userId", "email", "type", "pwd"}),
        (sign_account_setup_token("u1"), "account_setup", {"userId", "type"}),
    ):
        claims = jwt.decode(token, key_for(purpose, SECRET), algorithms=["HS256"], audience=f"vertex:{purpose}", issuer="vertex-web")
        assert set(claims) == fields | {"iat", "exp", "iss", "aud"}
    reset = jwt.decode(sign_reset_token("u1", "u@test.invalid", None), options={"verify_signature": False})
    setup = jwt.decode(sign_account_setup_token("u1"), options={"verify_signature": False})
    assert (reset["exp"] - reset["iat"], setup["exp"] - setup["iat"]) == (24 * 3600, 7 * 24 * 3600)
    assert verify_account_setup_token(sign_account_setup_token("u1")) == "u1"


def test_the_fingerprint_reveals_nothing_about_the_password():
    assert password_fingerprint("$2b$12$abc") != password_fingerprint("$2b$12$abd")
    assert "abc" not in password_fingerprint("$2b$12$abc") and len(password_fingerprint(None)) == 32


def test_links_and_passwords_never_reach_the_logs(api, db, lead, caplog):
    user = account(db)
    with caplog.at_level(logging.DEBUG):
        reg = post(api, "register", {"invite": invite_for(lead.id), "password": "Typed-Secret-77"})
        forgot = post(api, "forgot-password", {"email": user.email})
        reset_token = forgot.json()["notify"][0]["token"]
        post(api, "reset-password", {"token": reset_token, "password": "Typed-Secret-88"})
    secrets_seen = [reg.json()["notify"][0]["token"], reset_token, "Typed-Secret-77", "Typed-Secret-88"]
    logged = " ".join(r.getMessage() + json.dumps(getattr(r, "fields", {}), default=str) for r in caplog.records)
    assert not [s for s in secrets_seen if s in logged]


# --- as the API's database role -------------------------------------------------


def test_the_api_database_role_can_do_all_of_it(api, db, lead):
    user = account(db, verified=False)
    db.execute(text("SET LOCAL ROLE vertex_api"))
    try:
        reg = post(api, "register", {"invite": invite_for(lead.id), "password": PASSWORD})
        ver = post(api, "verify-email", {"token": sign_verification_token(user.id, user.email)})
        reset = post(api, "reset-password", {"token": sign_reset_token(user.id, user.email, user.password_hash), "password": PASSWORD})
    finally:
        db.execute(text("RESET ROLE"))
    assert (reg.status_code, ver.status_code, reset.status_code) == (201, 200, 200)
