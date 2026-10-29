"""Partner submission writes (pipeline handover step 6.6) answer as
Next.js's /api/partner/candidates[/draft|/[id]|/[id]/submit] and
/api/partner-candidates/[id][/create-case|/reject|/overturn] do: the same
roles, checks, messages and status codes, the same Candidate, Application
and case they create, and the emails the website must send."""

import re
import secrets

import pytest
from sqlalchemy import select, text

from app.api.v1 import partner_submissions as module
from app.api.v1.partner_submissions import DELETERS, REVIEWERS, SUBMITTERS
from app.core.config import BASE_DIR, settings
from app.db.session import get_db
from app.main import app
from app.models.audit import AuditLog
from app.models.candidate import Application, Candidate, Document
from app.models.cases import Case
from app.models.enums import CandidateLifecycleStatus, CandidateSource, JobStatus, PartnerCandidateStatus, PartnerType, Role
from app.models.identity import Country, Region, User
from app.models.jobs import Job
from app.models.partners import Partner, PartnerCandidate
from app.models.reference import CountryDocumentRequirement, DocumentRequirementType
from app.services import documents
from tests.test_auth import add_session, bearer, session_token
from tests.test_db_roles import roles_provisioned  # noqa: F401  (vertex_api must exist)

WEB = BASE_DIR.parent / "vertex" / "src"
API_TS = WEB / "app" / "api"
URL = "/api/v1"


@pytest.fixture
def api(db, client):
    app.dependency_overrides[get_db] = lambda: db
    yield client
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture(autouse=True)
def switched_on(monkeypatch):
    monkeypatch.setattr(settings, "PIPELINE_WRITES_ENABLED", True)


def person(db, role: Role, **fields) -> tuple[User, dict[str, str]]:
    u = User(full_name=f"{role.value} {secrets.token_hex(2)}", email=f"ps-{secrets.token_hex(4)}@test.invalid", role=role, **fields)
    db.add(u)
    db.flush()
    db.refresh(u)
    s = add_session(db, u.id)
    return u, bearer(session_token(u.id, s.family_id, u.token_version))


def new_partner(db, name="Bridge Agency") -> tuple[Partner, dict[str, str]]:
    user, session = person(db, Role.partner)
    partner = Partner(name=name, partner_type=PartnerType.other, country_of_operation="Kenya", contact_name="Pat", contact_email=f"p-{secrets.token_hex(3)}@test.invalid", contact_phone="1", user_id=user.id)
    db.add(partner)
    db.flush()
    return partner, session


@pytest.fixture
def world(db):
    region = Region(name=f"PS region {secrets.token_hex(3)}")
    db.add(region)
    db.flush()
    destination = Country(name=f"Psland {secrets.token_hex(3)}", region_id=region.id)
    db.add(destination)
    db.flush()
    job = Job(title="Welder", country=destination.name.lower(), city="Gdansk", job_description="d", requirements="r")
    permit_docs = DocumentRequirementType(key=f"permit_docs_{secrets.token_hex(3)}", label="Permit documents")
    db.add_all([job, permit_docs])
    db.flush()
    db.add(CountryDocumentRequirement(country_id=destination.id, document_type=permit_docs.key))
    partner, as_partner = new_partner(db)
    _, hr = person(db, Role.hr)
    _, ops = person(db, Role.operations_team)
    db.flush()
    required = sorted({permit_docs.key} | {k for k in db.scalars(select(DocumentRequirementType.key).where(DocumentRequirementType.is_universal.is_(True))) if not documents.is_non_programme_type(k)})
    return {"job": job, "destination": destination, "partner": partner, "as_partner": as_partner, "hr": hr, "ops": ops, "required": required, "permit_docs": permit_docs.key}


def form(world, **fields) -> dict:
    return {
        "full_name": "Juma Otieno",
        "nationality": "Kenyan",
        "date_of_birth": "1992-03-04",
        "gender": "male",
        "passport_number": f"AK{secrets.token_hex(4)}",
        "passport_expiry": "2032-01-01",
        "job_id": world["job"].id,
        "earliest_travel_date": "2027-02-01",
        "documents_available": world["required"],
        "payment_plan_acknowledged": True,
        "current_location_country_name": "Kenya",
        "preferred_contact_channel": "whatsapp",
    } | fields


def submit(api, world, headers=None, **fields):
    return api.post(f"{URL}/partner/candidates", headers=headers or world["as_partner"], json=form(world, **fields))


def error(res) -> dict:
    return res.json()["error"]


# --- drift -------------------------------------------------------------------


def _roles(path: str, pattern: str) -> set[str]:
    src = (API_TS / path).read_text(encoding="utf-8")
    return set(re.findall(r'"(\w+)"', re.search(pattern, src, re.S).group(1)))


def test_the_roles_match_next_js():
    from app.core.rbac import HR_ROLES

    for path in ("partner/candidates/route.ts", "partner/candidates/draft/route.ts", "partner/candidates/[id]/submit/route.ts"):
        assert _roles(path, r"export async function POST.*?requireRole\(user, \[(.*?)\]\)") == {r.value for r in SUBMITTERS}, path
    assert _roles("partner/candidates/[id]/route.ts", r"export async function PATCH.*?requireRole\(user, \[(.*?)\]\)") == {r.value for r in SUBMITTERS}
    assert _roles("partner/candidates/[id]/route.ts", r"export async function DELETE.*?requireRole\(user, \[(.*?)\]\)") == {"partner"}
    for path in ("partner-candidates/[id]/create-case/route.ts", "partner-candidates/[id]/reject/route.ts"):
        assert "requireRole(user, HR_ROLES)" in (API_TS / path).read_text(encoding="utf-8"), path
    assert "[...HR_ROLES]" in (API_TS / "partner-candidates/[id]/overturn/route.ts").read_text(encoding="utf-8")
    assert set(REVIEWERS) == set(HR_ROLES)
    assert _roles("partner-candidates/[id]/route.ts", r"const DELETE_ROLES = \[\.\.\.HR_ROLES, (.*?)\]") | {r.value for r in HR_ROLES} == {r.value for r in DELETERS}


def test_the_document_types_match_next_js():
    src = (WEB / "lib" / "documentTypes.ts").read_text(encoding="utf-8")
    non_programme = re.search(r"NON_PROGRAMME_TYPE_KEYS = \[(.*?)\]", src, re.S).group(1)
    assert set(re.findall(r'"(\w+)"', non_programme)) == documents.NON_PROGRAMME_TYPE_KEYS
    legacy = re.search(r"LEGACY_PAYMENT_RECEIPT_KEYS = \[(.*?)\]", src, re.S).group(1)
    assert set(re.findall(r'"(\w+)"', legacy)) == documents.LEGACY_PAYMENT_RECEIPT_KEYS
    assert f'PAYMENT_RECEIPT_TYPE_PREFIX = "{documents.PAYMENT_RECEIPT_TYPE_PREFIX}"' in src


def test_every_write_waits_for_the_switch(api, monkeypatch, world):
    monkeypatch.setattr(settings, "PIPELINE_WRITES_ENABLED", False)
    p, hr = world["as_partner"], world["hr"]
    calls = [
        ("post", "/partner/candidates", p), ("post", "/partner/candidates/draft", p), ("post", "/partner/candidates/cx/submit", p),
        ("patch", "/partner/candidates/cx", p), ("delete", "/partner/candidates/cx", p),
        ("patch", "/partner-candidates/cx/create-case", hr), ("patch", "/partner-candidates/cx/reject", hr),
        ("patch", "/partner-candidates/cx/overturn", hr), ("delete", "/partner-candidates/cx", hr),
    ]
    for verb, path, headers in calls:
        res = api.request(verb, URL + path, headers=headers, json={})
        assert (res.status_code, error(res)["code"]) == (503, "pipeline_not_enabled"), path
    assert len(module.router.routes) == len(calls)


# --- submitting --------------------------------------------------------------


def test_a_partner_submits_a_candidate(api, db, world):
    res = submit(api, world)
    assert res.status_code == 201
    out = res.json()
    data = out["data"]
    candidate = db.get(Candidate, data["candidateId"])
    application = db.get(Application, data["applicationId"])
    assert (data["status"], data["bridged_candidate_id"], data["submitted_by"] is not None) == ("submitted", candidate.id, True)
    assert (candidate.source, candidate.partner_id, candidate.country_id, candidate.lifecycle_status, candidate.consent_given) == (
        CandidateSource.partner_sourced, world["partner"].id, None, CandidateLifecycleStatus.submitted, True
    )
    assert (application.job_id, application.documents_available, application.preferred_contact_channel.value) == (world["job"].id, world["required"], "whatsapp")
    assert out["notify"] == [{"kind": "partner_candidate_submitted", "partner_name": "Bridge Agency", "candidate_name": "Juma Otieno"}]
    for entity in (candidate.id, application.id, data["id"]):
        assert db.scalars(select(AuditLog.action).where(AuditLog.entity_id == entity)).all() == ["create"]


def test_staff_submit_for_a_named_partner(api, db, world):
    res = submit(api, world, world["hr"], partner_id=world["partner"].id)
    assert db.get(Candidate, res.json()["data"]["candidateId"]).partner_id == world["partner"].id
    missing = submit(api, world, world["hr"])
    assert (missing.status_code, error(missing)["message"]) == (422, "partner_id is required and must reference a real partner.")
    _, recruiter = person(db, Role.regional_recruiter)
    assert submit(api, world, recruiter).status_code == 403


def test_the_checks_before_anything_is_created(api, db, world):
    passport = f"DUP{secrets.token_hex(3)}"
    submit(api, world, passport_number=passport)
    dup = submit(api, world, passport_number=passport)
    assert (dup.status_code, error(dup)["code"]) == (422, "duplicate_passport")
    incomplete = submit(api, world, documents_available=[])
    assert (incomplete.status_code, error(incomplete)["code"]) == (422, "documents_incomplete")
    assert world["permit_docs"] in error(incomplete)["message"]
    world["job"].status = JobStatus.closed
    db.flush()
    closed = submit(api, world)
    assert (closed.status_code, error(closed)["message"]) == (404, "Applications for this programme are closed.")
    assert submit(api, world, payment_plan_acknowledged=False).status_code == 422
    assert submit(api, world, gender="").status_code == 422
    names = db.scalars(select(Candidate.full_name).where(Candidate.partner_id == world["partner"].id)).all()
    assert names == ["Juma Otieno"]  # only the first got through


# --- drafts ------------------------------------------------------------------


def test_a_draft_is_saved_then_finished(api, db, world):
    draft = api.post(f"{URL}/partner/candidates/draft", headers=world["as_partner"], json={"full_name": "Half Done"}).json()["data"]
    assert (draft["status"], draft["full_name"], draft["documents_available"], draft["payment_plan_acknowledged"], draft["drafted_by"] is not None) == (
        "draft", "Half Done", [], False, True
    )
    doc = Document(partner_candidate_id=draft["id"], type=world["permit_docs"], storage_path="permit/draft.pdf")
    db.add(doc)
    db.flush()
    resaved = api.patch(f"{URL}/partner/candidates/{draft['id']}", headers=world["hr"], json={"nationality": "Kenyan"})
    assert resaved.json()["data"]["nationality"] == "Kenyan"  # staff may re-save a draft

    finished = api.post(f"{URL}/partner/candidates/{draft['id']}/submit", headers=world["as_partner"], json=form(world))
    assert finished.status_code == 200
    data = finished.json()["data"]
    assert (data["id"], data["status"]) == (draft["id"], "submitted")
    db.refresh(doc)
    assert doc.candidate_id == data["candidateId"]  # the draft's file moved to the candidate
    again = api.post(f"{URL}/partner/candidates/{draft['id']}/submit", headers=world["as_partner"], json=form(world))
    assert (again.status_code, error(again)["code"]) == (409, "invalid_state")
    late = api.patch(f"{URL}/partner/candidates/{draft['id']}", headers=world["hr"], json={"nationality": "Kenyan"})
    assert late.status_code == 404  # staff only touch drafts here


def test_a_draft_is_the_partners_own(api, db, world):
    draft = api.post(f"{URL}/partner/candidates/draft", headers=world["as_partner"], json={}).json()["data"]
    _, someone_else = new_partner(db, "Other Agency")
    assert error(api.post(f"{URL}/partner/candidates/{draft['id']}/submit", headers=someone_else, json=form(world)))["message"] == "Draft not found."
    assert api.delete(f"{URL}/partner/candidates/{draft['id']}", headers=someone_else).status_code == 404
    assert api.delete(f"{URL}/partner/candidates/{draft['id']}", headers=world["hr"]).status_code == 403  # partners only


def test_an_abandoned_draft_goes_with_its_documents(api, db, world):
    draft = api.post(f"{URL}/partner/candidates/draft", headers=world["as_partner"], json={}).json()["data"]
    doc = Document(partner_candidate_id=draft["id"], type=world["permit_docs"], storage_path="permit/abandoned.pdf")
    db.add(doc)
    db.flush()
    doc_id = doc.id
    res = api.delete(f"{URL}/partner/candidates/{draft['id']}", headers=world["as_partner"])
    assert res.json() == {"data": {"id": draft["id"]}}
    db.expire_all()
    assert (db.get(PartnerCandidate, draft["id"]), db.get(Document, doc_id)) == (None, None)
    submitted = submit(api, world).json()["data"]
    refused = api.delete(f"{URL}/partner/candidates/{submitted['id']}", headers=world["as_partner"])
    assert (refused.status_code, error(refused)["message"]) == (409, "Only an unsubmitted draft can be deleted.")


def test_a_partners_correction_follows_through(api, db, world):
    data = submit(api, world).json()["data"]
    res = api.patch(f"{URL}/partner/candidates/{data['id']}", headers=world["as_partner"], json={"full_name": "Juma O. Otieno", "holds_schengen_visa": True})
    assert res.json()["data"]["full_name"] == "Juma O. Otieno"
    assert db.get(Candidate, data["candidateId"]).full_name == "Juma O. Otieno"
    assert db.get(Application, data["applicationId"]).holds_schengen_visa is True


# --- HR's review -------------------------------------------------------------


def test_hr_opens_the_case(api, db, world):
    data = submit(api, world).json()["data"]
    res = api.patch(f"{URL}/partner-candidates/{data['id']}/create-case", headers=world["hr"])
    assert res.status_code == 200
    body = res.json()
    assert body["data"]["partnerCandidate"]["status"] == "job_assigned"
    case = db.get(Case, body["data"]["case"]["id"])
    assert (case.application_id, db.get(Candidate, data["candidateId"]).lifecycle_status) == (data["applicationId"], CandidateLifecycleStatus.approved)
    assert body["notify"] == [{"kind": "partner_case_created", "email": world["partner"].contact_email, "partner_name": "Bridge Agency", "candidate_name": "Juma Otieno"}]
    again = api.patch(f"{URL}/partner-candidates/{data['id']}/create-case", headers=world["hr"])
    assert (again.status_code, error(again)["code"]) == (409, "already_bridged")
    no_reject = api.patch(f"{URL}/partner-candidates/{data['id']}/reject", headers=world["hr"], json={"rejection_reason": "x"})
    assert no_reject.status_code == 409
    no_delete = api.delete(f"{URL}/partner-candidates/{data['id']}", headers=world["ops"])
    assert (no_delete.status_code, error(no_delete)["code"]) == (409, "case_exists")
    assert api.patch(f"{URL}/partner-candidates/{data['id']}/create-case", headers=world["ops"]).status_code == 403


def test_hr_rejects_and_overturns(api, db, world):
    data = submit(api, world).json()["data"]
    res = api.patch(f"{URL}/partner-candidates/{data['id']}/reject", headers=world["hr"], json={"rejection_reason": "Passport scan unreadable"})
    assert res.json()["data"]["status"] == "rejected"
    assert res.json()["notify"] == [{
        "kind": "partner_candidate_rejected", "email": world["partner"].contact_email, "partner_name": "Bridge Agency",
        "candidate_name": "Juma Otieno", "reason": "Passport scan unreadable",
    }]
    cannot = api.patch(f"{URL}/partner-candidates/{data['id']}/create-case", headers=world["hr"])
    assert (cannot.status_code, error(cannot)["code"]) == (422, "rejected")
    back = api.patch(f"{URL}/partner-candidates/{data['id']}/overturn", headers=world["hr"], json={"status": "submitted"})
    assert back.json()["data"] == {"id": data["id"], "status": "submitted", "rejection_reason": None}
    # As the website does today (flagged in the step 6.6 PR).
    assert db.get(Candidate, data["candidateId"]).lifecycle_status is CandidateLifecycleStatus.approved
    not_rejected = api.patch(f"{URL}/partner-candidates/{data['id']}/overturn", headers=world["hr"], json={"status": "submitted"})
    assert (not_rejected.status_code, error(not_rejected)["code"]) == (400, "not_rejected")


def test_drafts_are_not_in_hrs_review(api, world):
    draft = api.post(f"{URL}/partner/candidates/draft", headers=world["as_partner"], json={}).json()["data"]
    for verb, path in (("patch", "create-case"), ("patch", "reject")):
        res = api.request(verb, f"{URL}/partner-candidates/{draft['id']}/{path}", headers=world["hr"], json={"rejection_reason": "x"})
        assert (res.status_code, error(res)["message"]) == (404, "Partner candidate submission not found."), path


def test_a_submission_is_deleted_with_its_candidate(api, db, world):
    data = submit(api, world).json()["data"]
    res = api.delete(f"{URL}/partner-candidates/{data['id']}", headers=world["ops"])
    assert res.json() == {"data": {"id": data["id"]}}
    db.expire_all()
    assert (db.get(PartnerCandidate, data["id"]), db.get(Candidate, data["candidateId"]), db.get(Application, data["applicationId"])) == (None, None, None)
    assert db.scalars(select(AuditLog.action).where(AuditLog.entity_id == data["applicationId"])).all()[-1] == "delete"


# --- as the API's database role ---------------------------------------------


def test_the_api_database_role_can_write_them(api, db, world):
    db.execute(text("SET LOCAL ROLE vertex_api"))
    try:
        sub = submit(api, world)
        case = api.patch(f"{URL}/partner-candidates/{sub.json()['data']['id']}/create-case", headers=world["hr"])
        draft = api.post(f"{URL}/partner/candidates/draft", headers=world["as_partner"], json={})
        gone = api.delete(f"{URL}/partner/candidates/{draft.json()['data']['id']}", headers=world["as_partner"])
    finally:
        db.execute(text("RESET ROLE"))
    assert (sub.status_code, case.status_code, draft.status_code, gone.status_code) == (201, 200, 201, 200)
