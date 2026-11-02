"""Reads handover R1: the public job listing and detail, the application-fee
lookup, the apply options, the help articles, the assistant switch and the
document-type list. Each answers as the website's Prisma read did: the same
rows for the same caller, the same JSON keys."""

import re
import secrets

import pytest

from app.api.v1.jobs import PARTNER_JOB_VIEWERS
from app.api.v1.reference import DOCUMENT_TYPE_READERS
from app.core.config import BASE_DIR, settings
from app.db.session import get_db
from app.main import app
from app.models.candidate import Application, Candidate
from app.models.enums import JobStatus, Role
from app.models.identity import Country, Region, User
from app.models.jobs import Job, JobPaymentStage, JobPosition, JobSector
from app.models.reference import CountryDocumentRequirement, DocumentRequirementType, KnowledgeArticle, SystemSetting
from tests.test_auth import add_session, bearer, session_token
from tests.test_service_auth import SERVICE_SECRET, service_token

NEXT_API = BASE_DIR.parent / "vertex" / "src" / "app" / "api"
ISO_Z = re.compile(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z")

# publicJobs.ts's PUBLIC_JOB_LIST_SELECT and PUBLIC_JOB_DETAIL_SELECT.
LIST_KEYS = {
    "id", "title", "country", "city", "category", "tier", "salary_range", "job_description", "status", "created_at",
    "visa_type", "duration_permit", "service_fee_gbp", "partner_only", "is_credit_service", "payment_stages", "sectors", "_count",
}
DETAIL_KEYS = LIST_KEYS | {"requirements", "processing_time", "visa_success_rates"}
STAGE_KEYS = {
    "id", "job_id", "order", "label", "percent", "trigger_stage", "stripe_product_id", "stripe_price_id",
    "synced_amount_gbp", "created_at", "updated_at",
}


@pytest.fixture(autouse=True)
def website_secret(monkeypatch):
    monkeypatch.setattr(settings, "SERVICE_AUTH_SECRET", SERVICE_SECRET)
    monkeypatch.setattr(settings, "SERVICE_AUTH_SECRET_PREVIOUS", None)


@pytest.fixture
def api(db, client):
    app.dependency_overrides[get_db] = lambda: db
    yield client
    app.dependency_overrides.pop(get_db, None)


def website(session: dict[str, str] | None = None) -> dict[str, str]:
    """The website calling for a visitor, signed in or not."""
    return {"X-Vertex-Service": service_token()} | (session or {})


def signed_in(db, role: Role) -> dict[str, str]:
    u = User(full_name="Reads Test", email=f"reads-{secrets.token_hex(4)}@test.invalid", role=role)
    db.add(u)
    db.flush()
    db.refresh(u)
    s = add_session(db, u.id)
    return bearer(session_token(u.id, s.family_id, u.token_version))


def add_job(db, tag: str, **fields) -> Job:
    job = Job(
        title=f"{tag} {secrets.token_hex(3)}", country=fields.pop("country", f"Readland-{tag}"), city="Novi Sad",
        job_description="Seasonal farm work on a family-run orchard.", requirements="Two years of farm work.", **fields,
    )
    db.add(job)
    db.flush()
    return job


@pytest.fixture
def jobs(db):
    """One of each kind, all in their own country so other rows don't count."""
    country = f"Readland{secrets.token_hex(3)}"
    made = {
        "active": add_job(db, "Active", country=country, service_fee_gbp=1000, application_fee=25),
        "closed": add_job(db, "Closed", country=country, status=JobStatus.closed),
        "draft": add_job(db, "Draft", country=country, status=JobStatus.draft),
        "partner": add_job(db, "Partner", country=country, partner_only=True, is_credit_service=True),
    }
    a = made["active"]
    db.add_all([
        JobPaymentStage(job_id=a.id, order=2, label="Permit approved", percent=80, trigger_stage="permit_authorization_approved"),
        JobPaymentStage(job_id=a.id, order=1, label="At application", percent=20, trigger_stage="registration_document_submission"),
    ])
    sector = JobSector(job_id=a.id, sector="Agriculture")
    db.add(sector)
    db.flush()
    db.add(JobPosition(job_sector_id=sector.id, title="Picker", city="Subotica"))
    candidate = Candidate(full_name="Applicant")
    db.add(candidate)
    db.flush()
    db.add_all([Application(candidate_id=candidate.id, job_id=a.id) for _ in range(2)])
    db.flush()
    return country, made


def listed(api, country: str, headers: dict[str, str], **params) -> dict:
    res = api.get("/api/v1/jobs", headers=headers, params={"country": country, **params})
    assert res.status_code == 200, res.text
    return res.json()["data"]


def titles(data: dict) -> set[str]:
    return {j["title"].split(" ")[0] for j in data["jobs"]}


# --- the listing -------------------------------------------------------------


def test_a_visitor_sees_active_public_jobs(api, jobs):
    country, _ = jobs
    data = listed(api, country, website())
    assert titles(data) == {"Active"}
    assert (data["total"], data["page"], data["pages"]) == (1, 1, 1)


def test_the_jobs_page_also_shows_closed_ones(api, jobs):
    country, _ = jobs
    assert titles(listed(api, country, website(), status="public")) == {"Active", "Closed"}


def test_a_listed_job_has_the_websites_fields(api, jobs):
    country, made = jobs
    job = listed(api, country, website())["jobs"][0]
    assert set(job) == LIST_KEYS
    assert job["_count"] == {"applications": 2}
    assert [s["order"] for s in job["payment_stages"]] == [1, 2]
    assert set(job["payment_stages"][0]) == STAGE_KEYS
    assert job["sectors"] == [{"id": job["sectors"][0]["id"], "sector": "Agriculture", "positions": [
        {"id": job["sectors"][0]["positions"][0]["id"], "title": "Picker", "city": "Subotica"}]}]
    assert ISO_Z.fullmatch(job["created_at"])
    assert job["service_fee_gbp"] == 1000


@pytest.mark.parametrize("status", ["draft", "closed", "all"])
def test_only_a_job_manager_chooses_the_status(api, db, jobs, status):
    country, _ = jobs
    assert titles(listed(api, country, website(signed_in(db, Role.hr)), status=status)) == {"Active"}
    manager = titles(listed(api, country, website(signed_in(db, Role.marketing)), status=status))
    assert manager == {"draft": {"Draft"}, "closed": {"Closed"}, "all": {"Active", "Closed", "Draft", "Partner"}}[status]


def test_a_job_manager_sorts_their_list(api, db, jobs):
    country, _ = jobs
    marketing = website(signed_in(db, Role.marketing))
    by_title = [j["title"] for j in listed(api, country, marketing, status="all", sortBy="title", sortDir="asc")["jobs"]]
    assert by_title == sorted(by_title)
    most = listed(api, country, marketing, status="all", sortBy="applications")["jobs"][0]
    assert most["_count"]["applications"] == 2


def test_partner_only_jobs_need_a_partner_context(api, db, jobs):
    country, _ = jobs
    partner = website(signed_in(db, Role.partner))
    assert "Partner" not in titles(listed(api, country, partner))
    assert "Partner" in titles(listed(api, country, partner, audience="partner"))
    assert "Partner" not in titles(listed(api, country, website(), audience="partner"))
    assert "Partner" not in titles(listed(api, country, website(signed_in(db, Role.regional_recruiter)), audience="partner"))
    assert "Partner" in titles(listed(api, country, website(signed_in(db, Role.marketing))))


def test_the_page_size_is_capped(api, jobs):
    country, _ = jobs
    data = listed(api, country, website(), limit="500", status="public")
    assert data["pages"] == 1
    assert listed(api, country, website(), limit="1", status="public", page="2")["page"] == 2
    assert listed(api, country, website(), limit="abc")["total"] == 1


def test_the_search_is_case_insensitive_and_literal(api, jobs):
    country, made = jobs
    assert titles(listed(api, country.upper(), website(), q=made["active"].title.upper())) == {"Active"}
    assert listed(api, country, website(), q="100%")["total"] == 0


def test_a_signed_in_user_may_call_directly(api, db, jobs):
    # The Flutter app: its own session, no service credential.
    country, _ = jobs
    assert titles(listed(api, country, signed_in(db, Role.candidate))) == {"Active"}


def test_nobody_else_may_call(api):
    assert api.get("/api/v1/jobs").status_code == 401
    assert api.get("/api/v1/apply/options").status_code == 401


# --- the detail --------------------------------------------------------------


def test_a_public_job_in_detail(api, jobs):
    _, made = jobs
    res = api.get(f"/api/v1/jobs/{made['active'].id}", headers=website())
    assert res.status_code == 200
    assert set(res.json()["data"]) == DETAIL_KEYS
    assert api.get(f"/api/v1/jobs/{made['closed'].id}", headers=website()).json()["data"]["status"] == "closed"


def test_an_unknown_job_is_not_found(api):
    assert api.get("/api/v1/jobs/does-not-exist", headers=website()).status_code == 404


@pytest.mark.parametrize("kind", ["draft", "partner"])
def test_drafts_and_partner_only_jobs_are_not_found(api, jobs, kind):
    _, made = jobs
    res = api.get(f"/api/v1/jobs/{made[kind].id}", headers=website())
    assert (res.status_code, res.json()["error"]["message"]) == (404, "Job not found.")


def test_a_partner_sees_a_partner_only_job(api, db, jobs):
    _, made = jobs
    res = api.get(f"/api/v1/jobs/{made['partner'].id}", headers=website(signed_in(db, Role.partner)), params={"audience": "partner"})
    assert res.status_code == 200


def test_the_application_fee_is_for_signed_in_users(api, db, jobs):
    _, made = jobs
    url = f"/api/v1/jobs/{made['active'].id}/application-fee"
    assert api.get(url, headers=website()).status_code == 401
    res = api.get(url, headers=website(signed_in(db, Role.candidate)))
    assert res.json()["data"] == {"id": made["active"].id, "title": made["active"].title, "application_fee": 25}


def test_the_partner_viewers_match_the_website():
    src = (NEXT_API / "jobs" / "route.ts").read_text(encoding="utf-8")
    roles = re.search(r"PARTNER_JOB_VISIBILITY_ROLES: Role\[\] = \[(.*?)\]", src).group(1)
    assert set(re.findall(r'"(\w+)"', roles)) == {r.value for r in PARTNER_JOB_VIEWERS}


# --- apply options, help, assistant -------------------------------------------


@pytest.fixture
def places(db):
    europe = db.query(Region).filter_by(name="Europe").one_or_none() or Region(name="Europe")
    africa = Region(name=f"Readregion {secrets.token_hex(3)}")
    db.add_all([europe, africa])
    db.flush()
    here, there = Country(name=f"Readeu {secrets.token_hex(3)}", region_id=europe.id), Country(name=f"Readaf {secrets.token_hex(3)}", region_id=africa.id)
    doc = DocumentRequirementType(key=f"read_{secrets.token_hex(3)}", label="Read doc")
    db.add_all([here, there, doc])
    db.flush()
    db.add(CountryDocumentRequirement(country_id=here.id, document_type=doc.key))
    db.flush()
    return here, there, doc


def test_the_apply_options(api, db, places):
    here, there, doc = places
    data = api.get("/api/v1/apply/options", headers=website()).json()["data"]
    assert set(data) == {"countries", "locationCountries", "documentTypes", "documentRequirements", "intakeMode"}
    assert {"id": here.id, "name": here.name} in data["countries"] and {"id": there.id, "name": there.name} not in data["countries"]
    assert {"id": there.id, "name": there.name} in data["locationCountries"]
    assert data["countries"] == sorted(data["countries"], key=lambda c: c["name"])
    assert {"id", "key", "label", "is_universal", "sort_order", "created_at"} == set(next(t for t in data["documentTypes"] if t["key"] == doc.key))
    assert {"country_id": here.id, "document_type": doc.key} in data["documentRequirements"]


def set_setting(db, key: str, value: str | None) -> None:
    row = db.get(SystemSetting, key)
    if row is not None:
        db.delete(row)
        db.flush()
    if value is not None:
        db.add(SystemSetting(key=key, value=value))
    db.flush()


@pytest.mark.parametrize(("value", "mode"), [(None, "email"), ("crm", "crm"), ("anything", "email")])
def test_the_intake_mode_fails_safe(api, db, value, mode):
    set_setting(db, "intake_mode", value)
    assert api.get("/api/v1/apply/options", headers=website()).json()["data"]["intakeMode"] == mode


def test_the_help_articles(api, db):
    db.add(KnowledgeArticle(title="How to apply", category="Applying", content="Pick a programme."))
    db.flush()
    data = api.get("/api/v1/help/articles", headers=website()).json()["data"]
    assert {"id", "title", "category", "content", "created_at", "updated_at"} == set(data[0])
    assert any(a["title"] == "How to apply" for a in data)
    assert [a["category"] for a in data] == sorted(a["category"] for a in data)


@pytest.mark.parametrize(("value", "enabled"), [(None, True), ("true", True), ("false", False)])
def test_the_assistant_is_on_unless_turned_off(api, db, value, enabled):
    set_setting(db, "ai_enabled", value)
    assert api.get("/api/v1/assistant", headers=website()).json()["data"] == {"enabled": enabled}


# --- document types ----------------------------------------------------------


def test_the_document_type_readers_match_the_website():
    src = (NEXT_API / "admin" / "document-types" / "route.ts").read_text(encoding="utf-8")
    get = src[src.index("export async function GET"):]
    roles = re.search(r"requireRole\(user, \[(.*?)\]\)", get, re.S).group(1)
    assert set(re.findall(r'"(\w+)"', roles)) == {r.value for r in DOCUMENT_TYPE_READERS}


def test_the_document_types(api, db, places):
    _, _, doc = places
    assert api.get("/api/v1/document-types", headers=website(signed_in(db, Role.candidate))).status_code == 403
    data = api.get("/api/v1/document-types", headers=website(signed_in(db, Role.hr))).json()["data"]
    assert any(t["key"] == doc.key for t in data)
