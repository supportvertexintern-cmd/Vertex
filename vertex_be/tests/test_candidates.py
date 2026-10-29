"""Candidate writes (pipeline handover step 6.2) answer as Next.js's
/api/candidates/profile, /api/candidates/[id], /api/candidates/[id]/status,
/api/candidates/[id]/messages[/messageId] and registration do: the same
roles, access rules, transitions, messages, status codes and JSON, plus the
emails the website must send. All of them refuse until the switch."""

import re
import secrets
import time
from datetime import datetime

import jwt
import pytest
from sqlalchemy import select, text

from app.api.v1 import candidates as module
from app.api.v1.candidates import CASE_STAFF, DELETERS, DETAIL_EDITORS, MARITAL_STATUS_VALUES, STATUS_SETTERS
from app.core.config import BASE_DIR, settings
from app.core.tokens import key_for
from app.db.session import get_db
from app.main import app
from app.models.audit import AuditLog
from app.models.candidate import Application, Candidate, CandidateMessage, Document
from app.models.cases import Case
from app.models.enums import (
    CandidateLifecycleStatus,
    CandidateSource,
    Gender,
    PartnerCandidateStatus,
    PartnerType,
    Role,
)
from app.models.identity import Country, Region, User
from app.models.jobs import Job
from app.models.partners import Partner, PartnerCandidate
from app.models.reference import DocumentRequirementType
from tests.node_session_vectors import SECRET
from tests.test_auth import add_session, bearer, session_token
from tests.test_db_roles import roles_provisioned  # noqa: F401  (vertex_api must exist)
from tests.test_service_auth import SERVICE_SECRET, service_token

WEB = BASE_DIR.parent / "vertex" / "src"
NEXT_CANDIDATES = WEB / "app" / "api" / "candidates"
URL = "/api/v1/candidates"


@pytest.fixture
def api(db, client):
    app.dependency_overrides[get_db] = lambda: db
    yield client
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture(autouse=True)
def switched_on(monkeypatch):
    monkeypatch.setattr(settings, "PIPELINE_WRITES_ENABLED", True)


def person(db, role: Role, **fields) -> tuple[User, dict[str, str]]:
    u = User(full_name=f"{role.value} {secrets.token_hex(2)}", email=f"cand-{secrets.token_hex(4)}@test.invalid", role=role, **fields)
    db.add(u)
    db.flush()
    db.refresh(u)
    s = add_session(db, u.id)
    return u, bearer(session_token(u.id, s.family_id, u.token_version))


@pytest.fixture
def world(db):
    region = Region(name=f"Cand region {secrets.token_hex(3)}")
    db.add(region)
    db.flush()
    home = Country(name=f"Cand home {secrets.token_hex(3)}", region_id=region.id)
    away = Country(name=f"Cand away {secrets.token_hex(3)}", region_id=region.id)
    db.add_all([home, away])
    db.flush()
    recruiter, rec = person(db, Role.regional_recruiter, assigned_country_id=home.id)
    supervisor, sup = person(db, Role.country_supervisor, assigned_country_id=home.id)
    owner, own = person(db, Role.candidate)
    _, hr = person(db, Role.hr)
    _, admin = person(db, Role.admin)
    lead = Candidate(
        full_name="Abebe Kebede",
        email=f"lead-{secrets.token_hex(3)}@test.invalid",
        phone="+251911000000",
        nationality="Ethiopian",
        date_of_birth=datetime(1995, 5, 1),
        passport_number="EP1234567",
        passport_expiry=datetime(2030, 1, 1),
        consent_given=True,
        source=CandidateSource.recruiter_sourced,
        recruiter_id=recruiter.id,
        country_id=home.id,
    )
    mine = Candidate(full_name="Own profile", user_id=owner.id, recruiter_id=recruiter.id, country_id=home.id)
    other = Candidate(full_name="Elsewhere", country_id=away.id)
    db.add_all([lead, mine, other])
    db.flush()
    job = Job(title="Care worker", country=away.name, city="Berlin", job_description="d", requirements="r")
    db.add(job)
    db.flush()
    db.add(Application(candidate_id=lead.id, job_id=job.id, earliest_travel_date=datetime(2027, 1, 1)))
    db.flush()
    return {
        "home": home, "away": away, "job": job,
        "recruiter": recruiter, "rec": rec, "supervisor": supervisor, "sup": sup,
        "owner": owner, "own": own, "hr": hr, "admin": admin,
        "lead": lead, "mine": mine, "other": other,
    }


def error(res) -> dict:
    return res.json()["error"]


def trail(db, entity_id: str) -> list[str]:
    return list(db.scalars(select(AuditLog.action).where(AuditLog.entity_id == entity_id).order_by(AuditLog.created_at, AuditLog.id)))


# --- drift -------------------------------------------------------------------


def _ts_roles(path: str, pattern: str) -> set[str]:
    src = (NEXT_CANDIDATES / path).read_text(encoding="utf-8")
    return set(re.findall(r'"(\w+)"', re.search(pattern, src, re.S).group(1)))


def test_the_roles_match_next_js():
    assert _ts_roles("[id]/route.ts", r"export async function PATCH.*?requireRole\(user, \[(.*?)\]\)") == {r.value for r in DETAIL_EDITORS}
    assert _ts_roles("[id]/route.ts", r"export async function DELETE.*?requireRole\(user, \[(.*?)\]\)") == {r.value for r in DELETERS}
    assert _ts_roles("[id]/status/route.ts", r"requireRole\(user, \[(.*?)\]\)") == {r.value for r in STATUS_SETTERS}
    assert _ts_roles("[id]/messages/route.ts", r"const isCaseStaff =\s*\[(.*?)\]\.includes") == {r.value for r in CASE_STAFF}


def test_the_choices_match_next_js():
    marital = (WEB / "lib" / "maritalStatus.ts").read_text(encoding="utf-8")
    gender = (WEB / "lib" / "gender.ts").read_text(encoding="utf-8")
    assert re.findall(r'"(\w+)"', re.search(r"MARITAL_STATUS_VALUES = \[(.*?)\]", marital).group(1)) == list(MARITAL_STATUS_VALUES)
    assert re.findall(r'"(\w+)"', re.search(r"GENDER_VALUES = \[(.*?)\]", gender).group(1)) == [g.value for g in Gender]


def test_every_write_waits_for_the_switch(api, monkeypatch, world):
    monkeypatch.setattr(settings, "PIPELINE_WRITES_ENABLED", False)
    lead = world["lead"].id
    calls = [
        ("put", f"{URL}/profile", world["own"]),
        ("patch", f"{URL}/{lead}", world["rec"]),
        ("delete", f"{URL}/{lead}", world["hr"]),
        ("patch", f"{URL}/{lead}/status", world["rec"]),
        ("post", f"{URL}/{lead}/messages", world["rec"]),
        ("patch", f"{URL}/{lead}/messages/cx", world["rec"]),
        ("delete", f"{URL}/{lead}/messages/cx", world["rec"]),
    ]
    for method, url, headers in calls:
        res = api.request(method, url, headers=headers, json={})
        assert (res.status_code, error(res)["code"]) == (503, "pipeline_not_enabled"), url
    pipeline_routes = {f"{r.methods} {r.path}" for r in module.router.routes}
    assert len(pipeline_routes) == len(calls) + 1  # and the claim, below


# --- the candidate's own profile --------------------------------------------


def test_a_candidate_edits_their_profile(api, db, world):
    res = api.put(f"{URL}/profile", headers=world["own"], json={
        "nationality": "Kenyan", "date_of_birth": "1990-02-03", "passport_expiry": "", "gender": "female", "marital_status": "",
    })
    assert res.status_code == 200
    data = res.json()["data"]
    assert (data["id"], data["nationality"], data["date_of_birth"], data["passport_expiry"], data["gender"], data["marital_status"]) == (
        world["mine"].id, "Kenyan", "1990-02-03T00:00:00.000Z", None, "female", None
    )
    assert data["lifecycle_status"] == "identified" and "screening_result" in data
    assert trail(db, world["mine"].id)[-1] == "update"


@pytest.mark.parametrize(
    "body",
    [{"gender": "other"}, {"marital_status": "Complicated"}, {"whatsapp_number": "1" * 31}, {"date_of_birth": "not a date"}],
)
def test_a_bad_profile_is_refused(api, world, body):
    res = api.put(f"{URL}/profile", headers=world["own"], json=body)
    assert (res.status_code, error(res)["code"]) == (422, "validation_error")


def test_no_profile_no_edit(api, world):
    res = api.put(f"{URL}/profile", headers=world["hr"], json={"nationality": "Kenyan"})
    assert (res.status_code, error(res)["message"]) == (404, "No candidate profile for this account.")


# --- staff edits -------------------------------------------------------------


def test_the_recruiter_corrects_their_candidate(api, db, world):
    res = api.patch(f"{URL}/{world['lead'].id}", headers=world["rec"], json={"full_name": "Abebe K. Kebede", "consent_given": True, "email": ""})
    assert res.status_code == 200
    data = res.json()["data"]
    assert (data["full_name"], data["consent_given"], data["consent_at"] is not None) == ("Abebe K. Kebede", True, True)
    assert set(data) == set(module.CandidateDetails.model_fields)
    withdrawn = api.patch(f"{URL}/{world['lead'].id}", headers=world["rec"], json={"consent_given": False}).json()["data"]
    assert (withdrawn["consent_given"], withdrawn["consent_at"]) == (False, None)


def test_staff_edits_stay_in_scope(api, db, world):
    res = api.patch(f"{URL}/{world['other'].id}", headers=world["rec"], json={"full_name": "Someone"})
    assert (res.status_code, error(res)["code"]) == (403, "forbidden")
    _, inhouse = person(db, Role.inhouse_supervisor)
    assert api.patch(f"{URL}/{world['lead'].id}", headers=inhouse, json={}).status_code == 403  # not an editor
    assert api.patch(f"{URL}/cnosuchcandidate", headers=world["hr"], json={}).status_code == 404
    assert api.patch(f"{URL}/{world['lead'].id}", headers=world["rec"], json={"full_name": "A"}).status_code == 422


def test_a_partner_submissions_snapshot_follows_the_edit(api, db, world):
    partner_user, _ = person(db, Role.partner)
    partner = Partner(name="P", partner_type=PartnerType.other, country_of_operation="Kenya", contact_name="Pat", contact_email=f"p-{secrets.token_hex(3)}@test.invalid", contact_phone="1", user_id=partner_user.id)
    db.add(partner)
    db.flush()
    snapshot = PartnerCandidate(partner_id=partner.id, full_name="Old", phone="111", bridged_candidate_id=world["lead"].id)
    db.add(snapshot)
    db.flush()
    res = api.patch(f"{URL}/{world['lead'].id}", headers=world["hr"], json={"full_name": "New Name", "phone": "999", "date_of_birth": "1994-04-04"})
    assert res.status_code == 200
    db.refresh(snapshot)
    assert (snapshot.full_name, snapshot.phone, snapshot.date_of_birth) == ("New Name", "111", datetime(1994, 4, 4))
    assert trail(db, snapshot.id)[-1] == "update"


def test_a_candidate_is_deleted_with_their_records(api, db, world):
    lead = world["lead"]
    message = CandidateMessage(candidate_id=lead.id, sender_id=world["recruiter"].id, body="Hi")
    db.add(message)
    db.flush()
    [application_id] = db.scalars(select(Application.id).where(Application.candidate_id == lead.id)).all()
    assert api.delete(f"{URL}/{lead.id}", headers=world["rec"]).status_code == 403  # recruiters don't delete
    res = api.delete(f"{URL}/{lead.id}", headers=world["hr"])
    assert (res.status_code, res.json()) == (200, {"data": {"id": lead.id}})
    db.expire_all()
    assert db.get(Candidate, lead.id) is None
    assert (trail(db, lead.id)[-1], trail(db, application_id)[-1], trail(db, message.id)[-1]) == ("delete", "delete", "delete")


def test_a_candidate_with_a_case_is_kept(api, db, world):
    application = db.scalar(select(Application).where(Application.candidate_id == world["lead"].id))
    db.add(Case(application_id=application.id))
    db.flush()
    res = api.delete(f"{URL}/{world['lead'].id}", headers=world["admin"])
    assert (res.status_code, error(res)["code"]) == (409, "case_exists")


# --- lifecycle status --------------------------------------------------------


def status(api, world, headers, candidate=None, **body):
    return api.patch(f"{URL}/{(candidate or world['lead']).id}/status", headers=headers, json=body)


def test_screening_a_lead_invites_them(api, db, world):
    res = status(api, world, world["rec"], lifecycle_status="screened")
    assert res.status_code == 200
    body = res.json()
    assert body["data"] == {"id": world["lead"].id, "lifecycle_status": "screened", "return_reason": None}
    assert body["notify"] == [{"kind": "candidate_invite", "candidate_id": world["lead"].id, "email": world["lead"].email, "full_name": "Abebe Kebede"}]


def test_a_failed_screening_is_recorded(api, db, world):
    world["lead"].consent_given = False
    db.flush()
    res = status(api, world, world["rec"], lifecycle_status="screened")
    assert (res.status_code, error(res)["code"], error(res)["details"]) == (422, "screening_gate_failed", ["Candidate consent has not been recorded."])
    db.refresh(world["lead"])
    assert (world["lead"].lifecycle_status, world["lead"].screening_result) == (CandidateLifecycleStatus.identified, False)


def test_a_return_needs_a_reason(api, db, world):
    world["lead"].lifecycle_status = CandidateLifecycleStatus.reported
    db.flush()
    res = status(api, world, world["sup"], lifecycle_status="submitted")
    assert (res.status_code, error(res)["code"]) == (422, "return_reason_required")
    res = status(api, world, world["sup"], lifecycle_status="submitted", return_reason="Passport scan is blurred.")
    assert res.json()["data"] == {"id": world["lead"].id, "lifecycle_status": "submitted", "return_reason": "Passport scan is blurred."}
    assert "notify" not in res.json() or res.json()["notify"] == []
    forward = status(api, world, world["rec"], lifecycle_status="reported")
    assert forward.json()["data"]["return_reason"] is None


def test_a_move_the_rules_refuse(api, world):
    res = status(api, world, world["rec"], lifecycle_status="verified")
    assert (res.status_code, error(res)) == (422, {"code": "invalid_transition", "message": "Only a supervisor can verify or approve a candidate."})
    assert status(api, world, world["rec"], world["other"], lifecycle_status="screened").status_code == 403


def test_hr_rejects_a_self_application(api, db, world):
    world["lead"].source = CandidateSource.self_registered
    db.flush()
    res = status(api, world, world["hr"], lifecycle_status="rejected", return_reason="Not eligible for this programme.")
    assert res.json()["data"]["lifecycle_status"] == "rejected"
    assert res.json()["data"]["return_reason"] == "Not eligible for this programme."


def test_approval_opens_the_case(api, db, world):
    world["lead"].lifecycle_status = CandidateLifecycleStatus.verified
    db.flush()
    res = status(api, world, world["admin"], lifecycle_status="approved")
    assert res.status_code == 200
    assert res.json()["data"]["lifecycle_status"] == "approved"
    assert res.json()["notify"] == [{"kind": "candidate_approved", "email": world["lead"].email, "full_name": "Abebe Kebede"}]
    application = db.scalar(select(Application).where(Application.candidate_id == world["lead"].id))
    case = db.scalar(select(Case).where(Case.application_id == application.id))
    assert (case.current_stage.value, [e.stage.value for e in case.stage_events]) == ("registration_document_submission", ["registration_document_submission"])
    assert trail(db, case.id) == ["create"]


# --- messages ----------------------------------------------------------------


def test_a_candidate_writes_to_their_recruiter(api, db, world):
    res = api.post(f"{URL}/{world['mine'].id}/messages", headers=world["own"], json={"body": "  When is my interview?  "})
    assert res.status_code == 201
    body = res.json()
    assert body["data"]["body"] == "When is my interview?"
    assert body["data"]["sender"] == {"full_name": world["owner"].full_name, "role": "candidate"}
    assert body["notify"] == [{
        "kind": "candidate_message", "email": world["recruiter"].email, "full_name": world["recruiter"].full_name,
        "view_path": f"/recruiter/candidates/{world['mine'].id}",
    }]
    assert trail(db, body["data"]["id"]) == ["create"]


def test_the_recruiter_answers_the_candidate(api, world):
    res = api.post(f"{URL}/{world['mine'].id}/messages", headers=world["rec"], json={"body": "Tuesday."})
    assert res.json()["notify"] == [{"kind": "candidate_message", "email": world["owner"].email, "full_name": world["owner"].full_name, "view_path": "/dashboard"}]


def test_hr_on_a_partner_submission(api, db, world):
    partner_user, as_partner = person(db, Role.partner)
    partner = Partner(name="P", partner_type=PartnerType.other, country_of_operation="Kenya", contact_name="Pat", contact_email=f"p-{secrets.token_hex(3)}@test.invalid", contact_phone="1", user_id=partner_user.id)
    db.add(partner)
    db.flush()
    world["lead"].partner_id = partner.id
    submission = PartnerCandidate(partner_id=partner.id, full_name="Abebe", status=PartnerCandidateStatus.submitted, bridged_candidate_id=world["lead"].id)
    db.add(submission)
    db.flush()
    res = api.post(f"{URL}/{world['lead'].id}/messages", headers=world["hr"], json={"body": "Looking at it."})
    assert res.json()["notify"] == [{"kind": "candidate_message", "email": partner.contact_email, "full_name": "Pat", "view_path": "/partner"}]
    db.refresh(submission)
    assert submission.status is PartnerCandidateStatus.under_review
    # The partner's reply goes to whoever reviewed it; nobody has yet.
    assert api.post(f"{URL}/{world['lead'].id}/messages", headers=as_partner, json={"body": "Thanks"}).json()["notify"] == []


def test_strangers_and_bad_messages_are_refused(api, world):
    assert api.post(f"{URL}/{world['lead'].id}/messages", headers=world["sup"], json={"body": "Hi"}).status_code == 403
    assert api.post(f"{URL}/{world['lead'].id}/messages", headers=world["hr"], json={"body": "Hi"}).status_code == 403  # not a self-application
    for body, message in (({"body": "   "}, "Message body is required."), ({}, "Message body is required."), ({"body": "x" * 4001}, "Message is too long.")):
        res = api.post(f"{URL}/{world['lead'].id}/messages", headers=world["rec"], json=body)
        assert (res.status_code, error(res)) == (422, {"code": "validation_error", "message": message})
    assert api.post(f"{URL}/cnosuch/messages", headers=world["rec"], json={"body": "Hi"}).status_code == 404


def test_only_the_sender_edits_or_removes_a_message(api, db, world):
    posted = api.post(f"{URL}/{world['mine'].id}/messages", headers=world["own"], json={"body": "Typo"}).json()["data"]
    path = f"{URL}/{world['mine'].id}/messages/{posted['id']}"
    res = api.patch(path, headers=world["rec"], json={"body": "Mine now"})
    assert (res.status_code, error(res)["message"]) == (403, "You can only edit your own messages.")
    assert api.patch(path, headers=world["own"], json={"body": "Fixed"}).json()["data"]["body"] == "Fixed"
    assert api.patch(f"{URL}/{world['lead'].id}/messages/{posted['id']}", headers=world["own"], json={"body": "x"}).status_code == 404
    res = api.delete(path, headers=world["rec"])
    assert (res.status_code, error(res)["message"]) == (403, "You can only delete your own messages.")
    assert api.delete(path, headers=world["own"]).json() == {"data": {"id": posted["id"]}}
    assert trail(db, posted["id"]) == ["create", "update", "delete"]


# --- registration claims the candidate ---------------------------------------


@pytest.fixture
def service(monkeypatch):
    monkeypatch.setattr(settings, "SERVICE_AUTH_SECRET", SERVICE_SECRET)
    monkeypatch.setattr(settings, "SERVICE_AUTH_SECRET_PREVIOUS", None)
    return {"X-Vertex-Service": service_token()}


def invite_for(candidate_id: str) -> str:
    claims = {"candidateId": candidate_id, "type": "candidate_invite", "exp": int(time.time()) + 600, "iss": "vertex-web", "aud": "vertex:candidate_invite"}
    return jwt.encode(claims, key_for("candidate_invite", SECRET), algorithm="HS256")


@pytest.fixture
def invited(db, world):
    """A screened lead, a document type everyone needs, and the account
    registration has just created for them."""
    lead = world["lead"]
    lead.lifecycle_status = CandidateLifecycleStatus.screened
    db.add(DocumentRequirementType(key=f"doc_{secrets.token_hex(3)}", label="Passport", is_universal=True))
    account = User(full_name=lead.full_name, email=lead.email, role=Role.candidate)
    db.add(account)
    db.flush()
    return {"lead": lead, "account": account}


def test_registration_claims_the_screened_candidate(api, db, service, invited):
    lead = invited["lead"]
    res = api.post(f"{URL}/claim", headers=service, json={"invite": invite_for(lead.id), "user_id": invited["account"].id})
    assert (res.status_code, res.json()) == (200, {"data": {"id": lead.id, "lifecycle_status": "guided_to_apply"}})
    db.refresh(lead)
    assert lead.user_id == invited["account"].id
    claimed = [row for row in db.scalars(select(AuditLog).where(AuditLog.entity_id == lead.id)) if (row.after or {}).get("user_id")]
    assert [row.actor_id for row in claimed] == [None]  # self-service
    again = api.post(f"{URL}/claim", headers=service, json={"invite": invite_for(lead.id), "user_id": invited["account"].id})
    assert (again.status_code, error(again)["code"]) == (410, "invite_used")


def test_documents_already_on_the_form_submit_at_once(api, db, service, invited):
    lead = invited["lead"]
    universal = db.scalars(select(DocumentRequirementType.key).where(DocumentRequirementType.is_universal.is_(True))).all()
    db.add_all([Document(candidate_id=lead.id, type=key, storage_path=f"x/{key}") for key in universal])
    db.flush()
    res = api.post(f"{URL}/claim", headers=service, json={"invite": invite_for(lead.id), "user_id": invited["account"].id})
    assert res.json()["data"]["lifecycle_status"] == "submitted"


def test_a_claim_only_comes_from_the_website(api, invited):
    body = {"invite": invite_for(invited["lead"].id), "user_id": invited["account"].id}
    assert api.post(f"{URL}/claim", json=body).status_code == 401
    assert api.post(f"{URL}/claim", headers=bearer("x"), json=body).status_code == 401


def test_a_claim_checks_the_invite_and_the_account(api, db, service, invited, world):
    lead = invited["lead"]
    bad = api.post(f"{URL}/claim", headers=service, json={"invite": "nope", "user_id": invited["account"].id})
    assert (bad.status_code, error(bad)["message"]) == (400, "This invite link is invalid or has expired.")
    stranger, _ = person(db, Role.candidate)
    wrong = api.post(f"{URL}/claim", headers=service, json={"invite": invite_for(lead.id), "user_id": stranger.id})
    assert (wrong.status_code, error(wrong)["code"]) == (422, "account_mismatch")
    gone = api.post(f"{URL}/claim", headers=service, json={"invite": invite_for("cnosuchcandidate"), "user_id": invited["account"].id})
    assert gone.status_code == 410


# --- as the API's database role ---------------------------------------------


def test_the_api_database_role_can_write_them(api, db, world):
    db.execute(text("SET LOCAL ROLE vertex_api"))
    try:
        edit = api.patch(f"{URL}/{world['lead'].id}", headers=world["rec"], json={"desired_role": "Carer"})
        screen = status(api, world, world["rec"], lifecycle_status="screened")
        message = api.post(f"{URL}/{world['lead'].id}/messages", headers=world["rec"], json={"body": "Welcome"})
    finally:
        db.execute(text("RESET ROLE"))
    assert (edit.status_code, screen.status_code, message.status_code) == (200, 200, 201)
