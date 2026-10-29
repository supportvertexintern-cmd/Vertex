"""Case writes (pipeline handover step 6.5) answer as Next.js's
/api/cases/[id]/{stage,ops-review,reject,overturn,remind} do: the same
roles, access rules, checks, messages and status codes, with the referral
commissions, the retention follow-up and the emails the website must send.
All of them refuse until the switch."""

import re
import secrets
from datetime import datetime, timedelta

import pytest
from sqlalchemy import select, text

from app.api.v1 import cases as module
from app.api.v1.cases import OVERTURNERS, REJECTERS, STAGE_OWNERS
from app.core.config import BASE_DIR, settings
from app.db.session import get_db
from app.main import app
from app.models.audit import AuditLog
from app.models.candidate import Application, Candidate
from app.models.cases import Case, CaseReminder, CaseStageEvent, RetentionFollowUp
from app.models.enums import (
    ApplicationStatus,
    CandidateLifecycleStatus,
    CaseOpsReviewStatus,
    CaseStage,
    CaseStatus,
    PartnerType,
    ReferralMilestone,
    Role,
)
from app.models.identity import Country, Region, User
from app.models.jobs import Job
from app.models.partners import Partner
from app.models.referral import ReferralAgent, ReferralCommission, ReferralCommissionRule
from app.services.case_lifecycle import CASE_STAGE_ORDER, can_set_case_stage
from tests.test_auth import add_session, bearer, session_token
from tests.test_db_roles import roles_provisioned  # noqa: F401  (vertex_api must exist)

WEB = BASE_DIR.parent / "vertex" / "src"
CASES_TS = WEB / "app" / "api" / "cases" / "[id]"
URL = "/api/v1/cases"


@pytest.fixture
def api(db, client):
    app.dependency_overrides[get_db] = lambda: db
    yield client
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture(autouse=True)
def switched_on(monkeypatch):
    monkeypatch.setattr(settings, "PIPELINE_WRITES_ENABLED", True)


def person(db, role: Role, **fields) -> tuple[User, dict[str, str]]:
    u = User(full_name=f"{role.value} {secrets.token_hex(2)}", email=f"case-{secrets.token_hex(4)}@test.invalid", role=role, **fields)
    db.add(u)
    db.flush()
    db.refresh(u)
    s = add_session(db, u.id)
    return u, bearer(session_token(u.id, s.family_id, u.token_version))


@pytest.fixture
def world(db):
    region = Region(name=f"Case region {secrets.token_hex(3)}")
    db.add(region)
    db.flush()
    home = Country(name=f"Case home {secrets.token_hex(3)}", region_id=region.id)
    db.add(home)
    db.flush()
    account, own = person(db, Role.candidate)
    partner_user, _ = person(db, Role.partner)
    partner = Partner(name="Bridge Agency", partner_type=PartnerType.other, country_of_operation="Kenya", contact_name="Pat", contact_email=f"p-{secrets.token_hex(3)}@test.invalid", contact_phone="1", user_id=partner_user.id)
    agent = ReferralAgent(full_name="Ref Agent", email=f"ra-{secrets.token_hex(3)}@test.invalid", phone="1", country="Kenya", referral_code=f"R{secrets.token_hex(4)}")
    job = Job(title="Care worker", country="Germany", city="Berlin", job_description="d", requirements="r")
    db.add_all([partner, agent, job])
    db.flush()
    candidate = Candidate(
        full_name="Abebe Kebede", user_id=account.id, country_id=home.id, partner_id=partner.id, referral_agent_id=agent.id,
        lifecycle_status=CandidateLifecycleStatus.approved,
    )
    db.add(candidate)
    db.flush()
    application = Application(candidate_id=candidate.id, job_id=job.id, application_status=ApplicationStatus.approved)
    db.add(application)
    db.flush()
    case = Case(application_id=application.id, ops_review_status=CaseOpsReviewStatus.confirmed)
    db.add(case)
    db.flush()
    db.add(CaseStageEvent(case_id=case.id, stage=CaseStage.registration_document_submission))
    _, ops = person(db, Role.operations_team)
    _, hr = person(db, Role.hr)
    hr_user = db.scalar(select(User).where(User.role == Role.hr).limit(1))
    _, recruiter = person(db, Role.regional_recruiter)
    admin, _ = person(db, Role.admin)
    db.add(ReferralCommissionRule(country_id=home.id, milestone=ReferralMilestone.work_permit_approved, amount=75, currency="EUR", updated_by=admin.id))
    db.flush()
    return {"account": account, "own": own, "partner": partner, "agent": agent, "candidate": candidate, "application": application, "case": case, "ops": ops, "hr": hr, "hr_user": hr_user, "recruiter": recruiter}


def error(res) -> dict:
    return res.json()["error"]


# --- drift -------------------------------------------------------------------


def _ts(path: str) -> str:
    return (CASES_TS / path).read_text(encoding="utf-8")


def test_the_roles_match_next_js():
    from app.core.rbac import OPERATIONS_ROLES

    for path in ("stage/route.ts", "ops-review/route.ts", "remind/route.ts", "contract/route.ts", "retention/route.ts"):
        assert "requireRole(user, OPERATIONS_ROLES)" in _ts(path), path
    assert set(STAGE_OWNERS) == set(OPERATIONS_ROLES)
    assert "const CASE_REJECT_ROLES: Role[] = [...OPERATIONS_ROLES, \"hr\"];" in _ts("reject/route.ts")
    assert set(REJECTERS) == set(OPERATIONS_ROLES) | {Role.hr}
    overturners = re.search(r"const OVERTURN_REJECTION_ROLES: Role\[\] = \[(.*?)\]", _ts("overturn/route.ts")).group(1)
    assert set(re.findall(r'"(\w+)"', overturners)) == {r.value for r in OVERTURNERS}
    assert 'requireRole(user, ["candidate"])' in _ts("contract/sign/route.ts")


def test_the_stage_order_matches_the_website():
    lifecycle = (WEB / "server" / "services" / "caseLifecycle.ts").read_text(encoding="utf-8")
    order = re.search(r"export const CASE_STAGE_ORDER: CaseStage\[\] = \[(.*?)\];", lifecycle, re.S).group(1)
    assert re.findall(r'"(\w+)"', order) == [s.value for s in CASE_STAGE_ORDER]


def test_only_operations_move_stages():
    assert can_set_case_stage(Role.operations_team, CaseStage.visa_interview_decision, CaseStage.permit_application_submission).is_return
    assert not can_set_case_stage(Role.hr, CaseStage.registration_document_submission, CaseStage.permit_application_submission).allowed
    assert can_set_case_stage(Role.admin, CaseStage.visa_interview_decision, CaseStage.visa_interview_decision).reason == "Case is already at that stage."


def test_every_write_waits_for_the_switch(api, monkeypatch, world):
    monkeypatch.setattr(settings, "PIPELINE_WRITES_ENABLED", False)
    calls = (
        ("patch", "stage"), ("patch", "ops-review"), ("patch", "reject"), ("patch", "overturn"), ("post", "remind"),
        ("post", "contract"), ("post", "contract/sign"), ("patch", "retention"),
    )
    for verb, path in calls:
        headers = {"overturn": world["hr"], "contract/sign": world["own"]}.get(path, world["ops"])
        res = api.request(verb, f"{URL}/{world['case'].id}/{path}", headers=headers, json={})
        assert (res.status_code, error(res)["code"]) == (503, "pipeline_not_enabled"), path
    assert len(module.router.routes) == len(calls)


# --- stages ------------------------------------------------------------------


def stage(api, world, stage_key, headers=None, **body):
    return api.patch(f"{URL}/{world['case'].id}/stage", headers=headers or world["ops"], json={"stage": stage_key} | body)


def test_a_stage_move_closes_the_last_and_tells_both_sides(api, db, world):
    res = stage(api, world, "document_preparation_legalization", notes="Apostille booked", stage_date="2026-10-01")
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["current_stage"] == "document_preparation_legalization"
    events = data["stage_events"]
    assert [e["stage"] for e in events] == ["document_preparation_legalization", "registration_document_submission"]  # backdated first
    assert events[1]["completed_at"] is not None and events[0]["completed_at"] is None
    assert (events[0]["entered_at"], events[0]["notes"]) == ("2026-10-01T00:00:00.000Z", "Apostille booked")
    assert res.json()["notify"] == [
        {"kind": "case_stage", "email": world["account"].email, "full_name": world["account"].full_name, "job_title": "Care worker", "stage": "document_preparation_legalization"},
        {"kind": "partner_case_stage", "email": world["partner"].contact_email, "partner_name": "Bridge Agency", "candidate_name": "Abebe Kebede", "job_title": "Care worker", "stage": "document_preparation_legalization"},
    ]


def test_a_milestone_stage_earns_the_commission(api, db, world):
    res = stage(api, world, "permit_authorization_approved")
    commission = res.json()["notify"][0]
    assert (commission["kind"], commission["milestone"], commission["amount"]) == ("referral_commission_earned", "work_permit_approved", 75.0)
    row = db.scalars(select(ReferralCommission).where(ReferralCommission.candidate_id == world["candidate"].id)).one()
    assert row.case_id == world["case"].id


def test_the_last_stage_starts_the_retention_follow_up(api, db, world):
    stage(api, world, "departure_arrival_support")
    follow_up = db.scalar(select(RetentionFollowUp).where(RetentionFollowUp.case_id == world["case"].id))
    assert abs(follow_up.due_at - (datetime.utcnow() + timedelta(days=90))) < timedelta(minutes=5)
    stage(api, world, "pre_departure_arrangements")
    stage(api, world, "departure_arrival_support")
    assert len(db.scalars(select(RetentionFollowUp).where(RetentionFollowUp.case_id == world["case"].id)).all()) == 1


def test_stages_wait_for_the_documentation_review(api, db, world):
    world["case"].ops_review_status = CaseOpsReviewStatus.pending
    db.flush()
    res = stage(api, world, "document_preparation_legalization")
    assert (res.status_code, error(res)["code"]) == (422, "awaiting_ops_review")


def test_stage_moves_are_refused_when_they_should_be(api, db, world):
    same = stage(api, world, "registration_document_submission")
    assert (same.status_code, error(same)["message"]) == (403, "Case is already at that stage.")
    assert stage(api, world, "permit_application_submission", headers=world["hr"]).status_code == 403
    assert api.patch(f"{URL}/cnosuch/stage", headers=world["ops"], json={"stage": "permit_application_submission"}).status_code == 404
    world["case"].status = CaseStatus.rejected
    db.flush()
    closed = stage(api, world, "permit_application_submission")
    assert (closed.status_code, error(closed)["code"]) == (422, "case_rejected")


# --- documentation review ----------------------------------------------------


def test_operations_review_the_documentation(api, db, world):
    flagged = api.patch(f"{URL}/{world['case'].id}/ops-review", headers=world["ops"], json={"decision": "rejected"})
    assert flagged.status_code == 422  # a note is required
    res = api.patch(f"{URL}/{world['case'].id}/ops-review", headers=world["ops"], json={"decision": "rejected", "notes": "Passport scan unreadable"})
    data = res.json()["data"]
    assert (data["ops_review_status"], data["ops_review_notes"], data["ops_reviewed_by"]["full_name"].startswith("operations_team")) == ("rejected", "Passport scan unreadable", True)
    confirmed = api.patch(f"{URL}/{world['case'].id}/ops-review", headers=world["ops"], json={"decision": "confirmed"}).json()["data"]
    assert (confirmed["ops_review_status"], confirmed["ops_review_notes"]) == ("confirmed", None)


# --- rejection ---------------------------------------------------------------


def test_rejecting_a_case_closes_everything_and_tells_hr_and_the_partner(api, db, world):
    res = api.patch(f"{URL}/{world['case'].id}/reject", headers=world["hr"], json={"reason": "Fraudulent documents"})
    assert res.status_code == 200
    data = res.json()["data"]
    assert (data["status"], data["rejection_reason"], data["rejected_at"] is not None) == ("rejected", "Fraudulent documents", True)
    db.refresh(world["candidate"])
    db.refresh(world["application"])
    assert (world["candidate"].lifecycle_status, world["application"].application_status) == (CandidateLifecycleStatus.rejected, ApplicationStatus.rejected)
    notify = res.json()["notify"]
    hr_emails = {n["email"] for n in notify if n["kind"] == "case_rejected"}
    assert hr_emails == set(db.scalars(select(User.email).where(User.role == Role.hr)))
    assert notify[-1] == {"kind": "partner_case_rejected", "email": world["partner"].contact_email, "partner_name": "Bridge Agency", "candidate_name": "Abebe Kebede", "job_title": "Care worker", "reason": "Fraudulent documents"}
    again = api.patch(f"{URL}/{world['case'].id}/reject", headers=world["hr"], json={"reason": "Again"})
    assert (again.status_code, error(again)["code"]) == (409, "already_rejected")
    assert api.patch(f"{URL}/{world['case'].id}/reject", headers=world["recruiter"], json={"reason": "x"}).status_code == 403
    assert api.patch(f"{URL}/{world['case'].id}/reject", headers=world["ops"], json={"reason": ""}).status_code == 422


def test_an_overturned_rejection_restores_the_approval(api, db, world):
    not_yet = api.patch(f"{URL}/{world['case'].id}/overturn", headers=world["hr"], json={"status": "active"})
    assert (not_yet.status_code, error(not_yet)["code"]) == (400, "not_rejected")
    api.patch(f"{URL}/{world['case'].id}/reject", headers=world["hr"], json={"reason": "Mistake"})
    assert api.patch(f"{URL}/{world['case'].id}/overturn", headers=world["ops"], json={"status": "active"}).status_code == 403
    res = api.patch(f"{URL}/{world['case'].id}/overturn", headers=world["hr"], json={"status": "active"})
    assert res.json()["data"] == {"id": world["case"].id, "status": "active", "rejected_at": None, "rejection_reason": None, "rejected_by": None}
    db.refresh(world["candidate"])
    db.refresh(world["application"])
    assert (world["candidate"].lifecycle_status, world["application"].application_status) == (CandidateLifecycleStatus.approved, ApplicationStatus.approved)


# --- reminders ---------------------------------------------------------------


def test_a_reminder_is_recorded_and_left_for_the_website_to_send(api, db, world):
    res = api.post(f"{URL}/{world['case'].id}/remind", headers=world["ops"], json={"channel": "payment", "recipient": "partner", "message": "Stage 2 fee"})
    assert res.status_code == 201
    data = res.json()["data"]
    assert (data["channel"], data["recipient"], data["message"]) == ("payment", world["partner"].contact_email, "Stage 2 fee")
    assert res.json()["notify"] == [{
        "kind": "case_reminder", "email": world["partner"].contact_email, "recipient_name": "Pat", "candidate_name": world["account"].full_name,
        "programme_title": "Care worker", "channel": "payment", "message": "Stage 2 fee",
    }]
    assert db.scalars(select(AuditLog.action).where(AuditLog.entity_id == data["id"])).all() == ["create"]
    to_candidate = api.post(f"{URL}/{world['case'].id}/remind", headers=world["ops"], json={"channel": "document", "recipient": "candidate"}).json()
    assert to_candidate["data"]["recipient"] == world["account"].email


def test_a_reminder_needs_someone_to_send_to(api, db, world):
    world["candidate"].partner_id = None
    db.flush()
    db.expire_all()
    res = api.post(f"{URL}/{world['case'].id}/remind", headers=world["ops"], json={"channel": "document", "recipient": "partner"})
    assert (res.status_code, error(res)["message"]) == (422, "This candidate has no associated partner to remind.")
    assert db.scalars(select(CaseReminder).where(CaseReminder.case_id == world["case"].id)).all() == []


# --- as the API's database role ---------------------------------------------


def test_the_api_database_role_can_write_them(api, db, world):
    db.execute(text("SET LOCAL ROLE vertex_api"))
    try:
        moved = stage(api, world, "departure_arrival_support")
        reminded = api.post(f"{URL}/{world['case'].id}/remind", headers=world["ops"], json={"channel": "document", "recipient": "candidate"})
        rejected = api.patch(f"{URL}/{world['case'].id}/reject", headers=world["ops"], json={"reason": "Withdrew"})
    finally:
        db.execute(text("RESET ROLE"))
    assert (moved.status_code, reminded.status_code, rejected.status_code) == (200, 201, 200)


# --- the contract ------------------------------------------------------------


CONTRACT = "Employment contract terms for the placement in Berlin."


def test_operations_issue_and_the_candidate_signs(api, db, world):
    url = f"{URL}/{world['case'].id}/contract"
    assert api.post(url, headers=world["ops"], json={"content": "too short"}).status_code == 422
    issued = api.post(url, headers=world["ops"], json={"content": CONTRACT})
    assert issued.status_code == 201
    assert (issued.json()["data"]["status"], issued.json()["data"]["signed_at"]) == ("sent", None)
    twice = api.post(url, headers=world["ops"], json={"content": CONTRACT})
    assert (twice.status_code, error(twice)["code"]) == (409, "contract_exists")

    assert api.post(f"{url}/sign", headers=world["ops"], json={"signed_by_name": "Ops"}).status_code == 403  # staff never sign
    signed = api.post(f"{url}/sign", headers=world["own"], json={"signed_by_name": "Abebe Kebede"})
    data = signed.json()["data"]
    assert (data["status"], data["signed_by_name"], data["signed_at"] is not None, data["signed_ip"]) == ("signed", "Abebe Kebede", True, "testclient")
    again = api.post(f"{url}/sign", headers=world["own"], json={"signed_by_name": "Abebe Kebede"})
    assert (again.status_code, error(again)["message"]) == (409, "Contract already signed.")


def test_only_the_candidate_whose_case_it_is_signs(api, db, world):
    _, someone = person(db, Role.candidate)
    assert api.post(f"{URL}/{world['case'].id}/contract/sign", headers=someone, json={"signed_by_name": "Someone"}).status_code == 403
    nothing = api.post(f"{URL}/{world['case'].id}/contract/sign", headers=world["own"], json={"signed_by_name": "Abebe Kebede"})
    assert (nothing.status_code, error(nothing)["message"]) == (404, "No contract to sign yet.")


def test_a_forwarded_address_counts_only_from_the_website(api, db, world, monkeypatch):
    from tests.test_service_auth import SERVICE_SECRET, service_token

    monkeypatch.setattr(settings, "SERVICE_AUTH_SECRET", SERVICE_SECRET)
    monkeypatch.setattr(settings, "SERVICE_AUTH_SECRET_PREVIOUS", None)
    api.post(f"{URL}/{world['case'].id}/contract", headers=world["ops"], json={"content": CONTRACT})
    claimed = {"X-Forwarded-For": "203.0.113.9"}
    via_site = api.post(
        f"{URL}/{world['case'].id}/contract/sign",
        headers=world["own"] | claimed | {"X-Vertex-Service": service_token()},
        json={"signed_by_name": "Abebe Kebede"},
    )
    assert via_site.json()["data"]["signed_ip"] == "203.0.113.9"


def test_a_forwarded_address_without_the_website_is_ignored(api, db, world):
    api.post(f"{URL}/{world['case'].id}/contract", headers=world["ops"], json={"content": CONTRACT})
    direct = api.post(f"{URL}/{world['case'].id}/contract/sign", headers=world["own"] | {"X-Forwarded-For": "203.0.113.9"}, json={"signed_by_name": "Abebe Kebede"})
    assert direct.json()["data"]["signed_ip"] == "testclient"


# --- retention ---------------------------------------------------------------


def test_operations_complete_the_retention_follow_up(api, db, world):
    url = f"{URL}/{world['case'].id}/retention"
    early = api.patch(url, headers=world["ops"], json={})
    assert (early.status_code, error(early)["message"]) == (404, "No retention follow-up scheduled yet — the case must reach travel & settlement first.")
    stage(api, world, "departure_arrival_support")
    res = api.patch(url, headers=world["ops"], json={"notes": "Settled in, happy with the role."})
    data = res.json()["data"]
    assert (data["completed_at"] is not None, data["notes"]) == (True, "Settled in, happy with the role.")
    assert api.patch(url, headers=world["recruiter"], json={}).status_code == 403
