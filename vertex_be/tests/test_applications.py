"""Application writes (pipeline handover step 6.4) answer as Next.js's
POST /api/applications, PUT /api/applications/[id] and PATCH
/api/candidates/[id]/application do: the same roles, branches, checks,
messages and status codes, with the referral commissions and the emails the
website must send. All of them refuse until the switch."""

import re
import secrets
from datetime import datetime

import pytest
from sqlalchemy import select, text

from app.api.v1 import applications as module
from app.api.v1.applications import REVIEWERS
from app.core.config import BASE_DIR, settings
from app.db.session import get_db
from app.main import app
from app.models.audit import AuditLog
from app.models.candidate import Application, Candidate
from app.models.enums import (
    ApplicationStatus,
    CandidateLifecycleStatus,
    CandidateSource,
    JobStatus,
    PartnerType,
    PaymentStatus,
    ReferralAgentStatus,
    ReferralCommissionStatus,
    ReferralMilestone,
    Role,
)
from app.models.identity import Country, Region, User
from app.models.jobs import Job, JobPosition, JobSector
from app.models.partners import Partner, PartnerCandidate
from app.models.payments import Payment
from app.models.referral import ReferralAgent, ReferralCommission, ReferralCommissionRule
from tests.test_auth import add_session, bearer, session_token
from tests.test_db_roles import roles_provisioned  # noqa: F401  (vertex_api must exist)
from tests.test_service_auth import SERVICE_SECRET, service_token

NEXT = BASE_DIR.parent / "vertex" / "src" / "app" / "api"
URL = "/api/v1/applications"


@pytest.fixture
def api(db, client):
    app.dependency_overrides[get_db] = lambda: db
    yield client
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture(autouse=True)
def switched_on(monkeypatch):
    monkeypatch.setattr(settings, "PIPELINE_WRITES_ENABLED", True)
    monkeypatch.setattr(settings, "SERVICE_AUTH_SECRET", SERVICE_SECRET)
    monkeypatch.setattr(settings, "SERVICE_AUTH_SECRET_PREVIOUS", None)


def person(db, role: Role, **fields) -> tuple[User, dict[str, str]]:
    u = User(full_name=f"{role.value} {secrets.token_hex(2)}", email=f"app-{secrets.token_hex(4)}@test.invalid", role=role, **fields)
    db.add(u)
    db.flush()
    db.refresh(u)
    s = add_session(db, u.id)
    return u, bearer(session_token(u.id, s.family_id, u.token_version))


def as_service(session: dict[str, str] | None = None) -> dict[str, str]:
    return {"X-Vertex-Service": service_token()} | (session or {})


@pytest.fixture
def world(db):
    region = Region(name=f"App region {secrets.token_hex(3)}")
    db.add(region)
    db.flush()
    home = Country(name=f"Apphome {secrets.token_hex(3)}", region_id=region.id)
    db.add(home)
    db.flush()
    job = Job(title="Care worker", country="Germany", city="Berlin", job_description="d", requirements="r")
    other_job = Job(title="Welder", country="Poland", city="Gdansk", job_description="d", requirements="r")
    db.add_all([job, other_job])
    db.flush()
    sector = JobSector(job_id=job.id, sector="Healthcare")
    db.add(sector)
    db.flush()
    position = JobPosition(job_sector_id=sector.id, title="Carer")
    db.add(position)
    recruiter, rec = person(db, Role.regional_recruiter, assigned_country_id=home.id)
    _, inhouse = person(db, Role.inhouse_supervisor)
    _, hr = person(db, Role.hr)
    db.flush()
    return {"home": home, "job": job, "other_job": other_job, "position": position, "recruiter": recruiter, "rec": rec, "inhouse": inhouse, "hr": hr}


def form(world, **fields) -> dict:
    """A complete, eligible Candidate Information Form."""
    return {
        "job_id": world["job"].id,
        "job_position_id": world["position"].id,
        "full_name": "Abebe Kebede",
        "nationality": "Ethiopian",
        "date_of_birth": "1995-05-01",
        "passport_number": f"EP{secrets.token_hex(4)}",
        "passport_expiry": "2031-01-01",
        "gender": "male",
        "phone": f"+2519{secrets.randbelow(10**8):08d}",
        "email": f"applicant-{secrets.token_hex(4)}@test.invalid",
        "consent_given": True,
        "earliest_travel_date": "2027-03-01",
        "current_location_country_name": world["home"].name.upper(),
        "preferred_contact_channel": "whatsapp",
        "payment_plan_acknowledged": True,
        "documents_available": ["passport"],
    } | fields


def submit(api, body, session=None):
    return api.post(f"{URL}/submit", headers=as_service(session), json=body)


def error(res) -> dict:
    return res.json()["error"]


# --- drift -------------------------------------------------------------------


def test_the_roles_match_next_js():
    review_ts = (NEXT / "applications" / "[id]" / "route.ts").read_text(encoding="utf-8")
    reviewers = re.search(r"const APPLICATION_REVIEWER_ROLES = \[(.*?)\]", review_ts).group(1)
    assert set(re.findall(r'"(\w+)"', reviewers)) == {r.value for r in REVIEWERS}
    edit_ts = (NEXT / "candidates" / "[id]" / "application" / "route.ts").read_text(encoding="utf-8")
    editors = re.search(r"requireRole\(user, \[(.*?)\]\)", edit_ts, re.S).group(1)
    assert set(re.findall(r'"(\w+)"', editors)) == {r.value for r in module.DETAIL_EDITORS}


def test_every_write_waits_for_the_switch(api, monkeypatch, world):
    monkeypatch.setattr(settings, "PIPELINE_WRITES_ENABLED", False)
    for res in (
        submit(api, form(world)),
        api.put(f"{URL}/cx", headers=world["inhouse"], json={"internal_notes": "x"}),
        api.patch("/api/v1/candidates/cx/application", headers=world["rec"], json={}),
    ):
        assert (res.status_code, error(res)["code"]) == (503, "pipeline_not_enabled")
    assert len(module.router.routes) == 3


# --- submission --------------------------------------------------------------


def test_a_self_applicant_is_screened_and_invited(api, db, world):
    body = form(world)
    res = submit(api, body)
    assert res.status_code == 201
    out = res.json()
    app_row = out["data"]
    candidate = db.get(Candidate, app_row["candidate_id"])
    assert (candidate.source, candidate.recruiter_id, candidate.lifecycle_status, candidate.country_id, candidate.consent_given) == (
        CandidateSource.self_registered, None, CandidateLifecycleStatus.screened, world["home"].id, True
    )
    assert (app_row["job_position_id"], app_row["current_location_country_id"], app_row["documents_available"]) == (world["position"].id, world["home"].id, ["passport"])
    assert out["screening_passed"] is True
    assert [n["kind"] for n in out["notify"]] == ["candidate_invite", "application_confirmation"]
    assert out["notify"][1] == {"kind": "application_confirmation", "email": body["email"], "full_name": "Abebe Kebede", "job_title": "Care worker", "has_account": False}
    actors = set(db.scalars(select(AuditLog.actor_id).where(AuditLog.entity_id.in_([candidate.id, app_row["id"]]))))
    assert actors == {None}


def test_a_failed_screening_still_files_the_form(api, db, world):
    out = submit(api, form(world, passport_expiry="2027-01-01")).json()
    candidate = db.get(Candidate, out["data"]["candidate_id"])
    assert (out["screening_passed"], candidate.lifecycle_status, candidate.screening_result) == (False, CandidateLifecycleStatus.identified, False)
    assert [n["kind"] for n in out["notify"]] == ["application_confirmation"]


def test_a_recruiters_walk_in_lead_is_theirs_and_not_screened(api, db, world):
    out = submit(api, form(world), world["rec"]).json()
    candidate = db.get(Candidate, out["data"]["candidate_id"])
    assert (candidate.source, candidate.recruiter_id, candidate.lifecycle_status) == (CandidateSource.recruiter_sourced, world["recruiter"].id, CandidateLifecycleStatus.identified)
    assert out["screening_passed"] is False
    actor = db.scalars(select(AuditLog.actor_id).where(AuditLog.entity_id == candidate.id)).first()
    assert actor == world["recruiter"].id
    walk_in_by_hr = submit(api, form(world), world["inhouse"]).json()
    assert db.get(Candidate, walk_in_by_hr["data"]["candidate_id"]).recruiter_id is None


def test_section_2_is_required_without_a_candidate(api, world):
    res = submit(api, form(world, full_name=None, email="", consent_given=False, gender=""))
    assert (res.status_code, error(res)["code"]) == (422, "validation_error")
    assert error(res)["details"] == {
        "full_name": ["Full name is required"],
        "gender": ["Gender is required"],
        "email": ["A valid email is required"],
        "consent_given": ["You must confirm the candidate declaration to submit."],
    }
    for bad in ({"payment_plan_acknowledged": False}, {"preferred_contact_channel": "fax"}, {"job_id": "nope"}, {"earliest_travel_date": ""}):
        assert submit(api, form(world, **bad)).status_code == 422, bad


def test_staff_submit_for_a_candidate_on_file(api, db, world):
    lead = Candidate(full_name="On file", recruiter_id=world["recruiter"].id, country_id=world["home"].id, lifecycle_status=CandidateLifecycleStatus.guided_to_apply)
    db.add(lead)
    db.flush()
    body = {k: v for k, v in form(world).items() if k in ("job_id", "earliest_travel_date", "current_location_country_name", "preferred_contact_channel", "payment_plan_acknowledged")}
    res = submit(api, body | {"candidate_id": lead.id}, world["rec"])
    assert res.status_code == 201
    db.refresh(lead)
    assert (lead.lifecycle_status, lead.full_name) == (CandidateLifecycleStatus.submitted, "On file")  # Section 2 untouched
    again = submit(api, body | {"candidate_id": lead.id}, world["rec"])
    assert (again.status_code, error(again)["message"]) == (409, "This candidate already has an active application on file.")
    _, candidate_user = person(db, Role.candidate)
    refused = submit(api, body | {"candidate_id": lead.id}, candidate_user)
    assert (refused.status_code, error(refused)["message"]) == (403, "Only staff can submit an application on behalf of a candidate.")
    assert submit(api, body | {"candidate_id": lead.id}).status_code == 403  # anonymous


def test_a_signed_in_candidate_completes_their_form(api, db, world):
    account, session = person(db, Role.candidate)
    mine = Candidate(user_id=account.id)
    db.add(mine)
    db.flush()
    out = submit(api, form(world, full_name="Signed In Person"), session).json()
    db.refresh(mine)
    assert (out["data"]["candidate_id"], mine.full_name) == (mine.id, "Signed In Person")
    assert out["notify"][-1] == {"kind": "application_confirmation", "email": account.email, "full_name": account.full_name, "job_title": "Care worker", "has_account": True}
    assert submit(api, form(world), world["hr"]).status_code == 403  # not staff, not a candidate


def test_the_programme_must_be_open_and_the_position_its_own(api, db, world):
    world["other_job"].status = JobStatus.closed
    db.flush()
    closed = submit(api, form(world, job_id=world["other_job"].id, job_position_id=None))
    assert (closed.status_code, error(closed)["message"]) == (404, "Applications for this programme are closed.")
    assert error(submit(api, form(world, job_id="cnosuchjob000")))["message"] == "Opportunity not found."
    world["other_job"].status = JobStatus.active
    db.flush()
    mismatch = submit(api, form(world, job_id=world["other_job"].id))
    assert (mismatch.status_code, error(mismatch)["message"]) == (422, "Selected position does not belong to this opportunity.")


def test_a_fee_needs_the_candidates_own_payment(api, db, world):
    world["job"].application_fee = 50
    db.flush()
    anonymous = submit(api, form(world))
    assert (anonymous.status_code, error(anonymous)["code"]) == (402, "payment_required")
    account, session = person(db, Role.candidate)
    db.add(Candidate(user_id=account.id))
    db.flush()
    unpaid = submit(api, form(world), session)
    assert error(unpaid)["details"] == {"requiresPayment": True, "jobId": world["job"].id}
    db.add(Payment(user_id=account.id, job_id=world["job"].id, amount=50, payment_method="stripe", payment_status=PaymentStatus.completed))
    db.flush()
    assert submit(api, form(world), session).status_code == 201


@pytest.fixture
def agent(db, world):
    a = ReferralAgent(full_name="Ref Agent", email=f"ra-{secrets.token_hex(3)}@test.invalid", phone="1", country="Kenya", referral_code=f"R{secrets.token_hex(4)}", status=ReferralAgentStatus.active)
    admin, _ = person(db, Role.admin)
    db.add(a)
    db.flush()
    db.add(ReferralCommissionRule(country_id=world["home"].id, milestone=ReferralMilestone.registered, amount=10, currency="EUR", updated_by=admin.id))
    db.flush()
    return a


def test_a_referred_applicant_earns_their_agent_a_commission(api, db, world, agent):
    out = submit(api, form(world, referral_code=agent.referral_code)).json()
    candidate = db.get(Candidate, out["data"]["candidate_id"])
    assert (candidate.source, candidate.referral_agent_id, candidate.referral_duplicate_flag) == (CandidateSource.referral_sourced, agent.id, False)
    assert out["screening_passed"] is False  # referred applicants aren't screened on submission
    assert out["notify"][0] == {
        "kind": "referral_commission_earned", "agent_email": agent.email, "agent_name": "Ref Agent",
        "candidate_name": "Abebe Kebede", "milestone": "registered", "amount": 10.0, "currency": "EUR",
    }
    commission = db.scalars(select(ReferralCommission).where(ReferralCommission.candidate_id == candidate.id)).one()
    assert (commission.milestone, commission.status) == (ReferralMilestone.registered, ReferralCommissionStatus.pending)


def test_a_duplicate_referral_is_flagged_not_blocked(api, db, world, agent):
    first = form(world)
    submit(api, first)
    out = submit(api, form(world, referral_code=agent.referral_code, email=first["email"])).json()
    assert db.get(Candidate, out["data"]["candidate_id"]).referral_duplicate_flag is True


def test_an_unknown_or_inactive_code_is_ignored(api, db, world, agent):
    agent.status = ReferralAgentStatus.suspended
    db.flush()
    for code in (agent.referral_code, "NOPE"):
        out = submit(api, form(world, referral_code=code)).json()
        assert db.get(Candidate, out["data"]["candidate_id"]).source is CandidateSource.self_registered


def test_staff_never_attribute_a_referral(api, db, world, agent):
    out = submit(api, form(world, referral_code=agent.referral_code), world["rec"]).json()
    assert db.get(Candidate, out["data"]["candidate_id"]).referral_agent_id is None


def test_submission_is_for_the_website_only(api, world):
    assert api.post(f"{URL}/submit", json=form(world)).status_code == 401
    assert api.post(f"{URL}/submit", headers=world["rec"], json=form(world)).status_code == 401


# --- review ------------------------------------------------------------------


@pytest.fixture
def filed(db, world):
    account, _ = person(db, Role.candidate)
    candidate = Candidate(user_id=account.id, full_name="Filed", recruiter_id=world["recruiter"].id, country_id=world["home"].id)
    db.add(candidate)
    db.flush()
    application = Application(candidate_id=candidate.id, job_id=world["job"].id, earliest_travel_date=datetime(2027, 1, 1))
    db.add(application)
    db.flush()
    return {"account": account, "candidate": candidate, "application": application}


def test_a_status_change_tells_the_candidate(api, world, filed):
    res = api.put(f"{URL}/{filed['application'].id}", headers=world["inhouse"], json={"application_status": "interview"})
    assert res.status_code == 200
    assert res.json()["data"]["application_status"] == "interview"
    assert res.json()["notify"] == [{
        "kind": "application_status", "email": filed["account"].email, "full_name": filed["account"].full_name,
        "job_title": "Care worker", "status": "interview",
    }]


def test_a_notes_edit_tells_nobody(api, world, filed):
    res = api.put(f"{URL}/{filed['application'].id}", headers=world["inhouse"], json={"internal_notes": "Strong candidate."})
    assert (res.json()["data"]["internal_notes"], res.json()["notify"]) == ("Strong candidate.", [])


def test_review_is_for_reviewers(api, world, filed):
    assert api.put(f"{URL}/{filed['application'].id}", headers=world["rec"], json={"internal_notes": "x"}).status_code == 403
    assert api.put(f"{URL}/{filed['application'].id}", headers=world["inhouse"], json={}).status_code == 422
    assert api.put(f"{URL}/cnosuch", headers=world["inhouse"], json={"internal_notes": "x"}).status_code == 404


# --- staff corrections -------------------------------------------------------


def correct(api, world, candidate_id, body, headers=None):
    return api.patch(f"/api/v1/candidates/{candidate_id}/application", headers=headers or world["rec"], json=body)


def test_staff_correct_the_latest_application(api, db, world, filed):
    res = correct(api, world, filed["candidate"].id, {"earliest_travel_date": "2027-06-01", "holds_schengen_visa": True, "current_location_country_name": world["home"].name})
    assert res.status_code == 200
    data = res.json()["data"]
    assert (data["earliest_travel_date"], data["holds_schengen_visa"], data["current_location_country_id"]) == ("2027-06-01T00:00:00.000Z", True, world["home"].id)
    assert data["job_position_id"] is None


def test_a_new_job_clears_a_position_that_isnt_its_own(api, db, world, filed):
    filed["application"].job_position_id = world["position"].id
    db.flush()
    res = correct(api, world, filed["candidate"].id, {"job_id": world["other_job"].id})
    assert (res.json()["data"]["job_id"], res.json()["data"]["job_position_id"]) == (world["other_job"].id, None)
    bad = correct(api, world, filed["candidate"].id, {"job_position_id": world["position"].id})
    assert (bad.status_code, error(bad)["message"]) == (422, "Selected position does not belong to this opportunity.")
    assert error(correct(api, world, filed["candidate"].id, {"job_id": "cnosuchjob000"}))["message"] == "Selected opportunity not found."


def test_a_partner_submissions_copy_follows(api, db, world, filed):
    partner_user, _ = person(db, Role.partner)
    partner = Partner(name="P", partner_type=PartnerType.other, country_of_operation="Kenya", contact_name="Pat", contact_email=f"p-{secrets.token_hex(3)}@test.invalid", contact_phone="1", user_id=partner_user.id)
    db.add(partner)
    db.flush()
    copy = PartnerCandidate(partner_id=partner.id, full_name="Filed", bridged_candidate_id=filed["candidate"].id)
    db.add(copy)
    db.flush()
    correct(api, world, filed["candidate"].id, {"prior_visa_refusals": True, "prior_visa_refusals_details": "2019, Schengen"})
    db.refresh(copy)
    assert (copy.prior_visa_refusals, copy.prior_visa_refusals_details) == (True, "2019, Schengen")


def test_corrections_stay_in_scope(api, db, world, filed):
    elsewhere = Candidate(full_name="Elsewhere")
    db.add(elsewhere)
    db.flush()
    assert correct(api, world, elsewhere.id, {}).status_code == 403
    assert correct(api, world, filed["candidate"].id, {}, world["inhouse"]).status_code == 403  # not an editor
    no_application = correct(api, world, elsewhere.id, {}, world["hr"])
    assert (no_application.status_code, error(no_application)["message"]) == (404, "No application on file for this candidate.")


# --- as the API's database role ---------------------------------------------


def test_the_api_database_role_can_write_them(api, db, world, filed):
    db.execute(text("SET LOCAL ROLE vertex_api"))
    try:
        s = submit(api, form(world))
        r = api.put(f"{URL}/{filed['application'].id}", headers=world["inhouse"], json={"application_status": "under_review"})
        c = correct(api, world, filed["candidate"].id, {"willing_to_start_within_30_days": True})
    finally:
        db.execute(text("RESET ROLE"))
    assert (s.status_code, r.status_code, c.status_code) == (201, 200, 200)
    assert db.get(Application, filed["application"].id).application_status is ApplicationStatus.under_review
