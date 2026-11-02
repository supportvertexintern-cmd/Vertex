"""Reads handover R4: candidates, applications, a partner's own submissions
and HR's partner-submission queue (app/api/v1/pipeline_reads.py). Each
answers as the website's Prisma read did: the same rows for the same
caller, the same filters, summaries and JSON keys. Plus the owner's
decisions: Q2 (HR and operations see every submission) and Q3 (an in-house
supervisor opens an application only in their own countries)."""

import re
import secrets
from datetime import datetime

import pytest

from app.db.session import get_db
from app.main import app
from app.models.candidate import Application, Candidate, CandidateMessage, Document
from app.models.enums import CandidateLifecycleStatus as L, CandidateSource, PartnerCandidateStatus as PS, Role, VerificationStatus as V
from app.models.identity import Country, InhouseCountryAssignment, Region, User
from app.models.jobs import Job
from app.models.partners import Partner, PartnerCandidate
from app.models.reference import CountryDocumentRequirement, DocumentRequirementType
from tests.test_auth import add_session, bearer, session_token

ISO_Z = re.compile(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z")


@pytest.fixture
def api(db, client):
    app.dependency_overrides[get_db] = lambda: db
    yield client
    app.dependency_overrides.pop(get_db, None)


def tag() -> str:
    return secrets.token_hex(3)


def add_user(db, role: Role, **fields) -> User:
    u = User(full_name=f"Pipe {role.value} {tag()}", email=f"pipe-{tag()}@test.invalid", role=role, **fields)
    db.add(u)
    db.flush()
    db.refresh(u)
    return u


def h(db, user: User) -> dict[str, str]:
    s = add_session(db, user.id)
    return bearer(session_token(user.id, s.family_id, user.token_version))


@pytest.fixture
def world(db):
    region = Region(name=f"Piperegion {tag()}")
    db.add(region)
    db.flush()
    home = Country(name=f"Pipehome {tag()}", region_id=region.id)
    away = Country(name=f"Pipeaway {tag()}", region_id=region.id)
    db.add_all([home, away])
    passport = DocumentRequirementType(key=f"pipe_passport_{tag()}", label="Passport", is_universal=True)
    visa = DocumentRequirementType(key=f"pipe_visa_{tag()}", label="Visa form")
    db.add_all([passport, visa])
    db.flush()
    db.add(CountryDocumentRequirement(country_id=home.id, document_type=visa.key))
    recruiter = add_user(db, Role.regional_recruiter, assigned_country_id=home.id)
    other_recruiter = add_user(db, Role.regional_recruiter, assigned_country_id=away.id)
    supervisor = add_user(db, Role.country_supervisor, assigned_country_id=home.id)
    inhouse = add_user(db, Role.inhouse_supervisor)
    db.add(InhouseCountryAssignment(inhouse_supervisor_id=inhouse.id, country_id=home.id))
    account = add_user(db, Role.candidate)
    job = Job(title=f"{home.name} — Orchard Programme (Credit Service)", country=home.name.upper(), city="Town",
              job_description="Seasonal orchard work.", requirements="None.")
    db.add(job)
    db.flush()
    mine = Candidate(full_name="Ada Pipe", email=f"ada-{tag()}@test.invalid", country_id=home.id, recruiter_id=recruiter.id, user_id=account.id,
                     source=CandidateSource.self_registered, lifecycle_status=L.submitted)
    theirs = Candidate(full_name="Bo Pipe", country_id=away.id, recruiter_id=other_recruiter.id, source=CandidateSource.recruiter_sourced,
                       lifecycle_status=L.identified, screening_result=False)
    db.add_all([mine, theirs])
    db.flush()
    application = Application(candidate_id=mine.id, job_id=job.id)
    away_application = Application(candidate_id=theirs.id)
    db.add_all([application, away_application])
    db.add(Document(candidate_id=mine.id, type=passport.key, storage_path="x/p.pdf", verification_status=V.pending))
    db.add(CandidateMessage(candidate_id=mine.id, sender_id=account.id, body="Hello?"))
    partner_user = add_user(db, Role.partner)
    partner = Partner(name=f"Pipe Agency {tag()}", partner_type="travel_agency", country_of_operation="Kenya", contact_name="C",
                      contact_email=f"pa-{tag()}@test.invalid", contact_phone="+1", user_id=partner_user.id)
    rival = Partner(name=f"Rival Agency {tag()}", partner_type="travel_agency", country_of_operation="Kenya", contact_name="C",
                    contact_email=f"ra-{tag()}@test.invalid", contact_phone="+1")
    db.add_all([partner, rival])
    db.flush()
    bridged = Candidate(full_name="Cy Pipe", country_id=home.id, partner_id=partner.id, source=CandidateSource.partner_sourced)
    db.add(bridged)
    db.flush()
    db.add(Document(candidate_id=bridged.id, type=passport.key, storage_path="x/c.pdf", verification_status=V.rejected))
    db.add(CandidateMessage(candidate_id=bridged.id, sender_id=partner_user.id, body="Any news?"))
    submitted = PartnerCandidate(partner_id=partner.id, status=PS.submitted, full_name="Cy Pipe", job_id=job.id,
                                 bridged_candidate_id=bridged.id, submitted_at=datetime(2026, 10, 1))
    draft = PartnerCandidate(partner_id=partner.id, status=PS.draft, full_name="Draft Pipe")
    rivals = PartnerCandidate(partner_id=rival.id, status=PS.submitted, full_name="Rival Pipe", submitted_at=datetime(2026, 9, 1))
    db.add_all([submitted, draft, rivals])
    db.flush()
    return {k: v for k, v in locals().items() if k != "db"}


def data(res):
    assert res.status_code == 200, res.text
    return res.json()["data"]


def names(rows) -> set[str]:
    return {r["full_name"] for r in rows}


# --- roles --------------------------------------------------------------------------


@pytest.mark.parametrize("role", list(Role))
def test_who_may_read(api, db, world, role):
    headers = h(db, add_user(db, role))
    candidate_readers = {Role.regional_recruiter, Role.country_supervisor, Role.inhouse_supervisor, Role.director, Role.admin, Role.hr}
    queue = {Role.hr, Role.director, Role.admin, Role.operations_team, Role.operations_director}
    assert (api.get("/api/v1/candidates", headers=headers).status_code == 403) == (role not in candidate_readers)
    assert (api.get("/api/v1/partner-candidates", headers=headers).status_code == 403) == (role not in queue)
    assert (api.get("/api/v1/partner/candidates", headers=headers).status_code == 403) == (role is not Role.partner)


# --- candidates -----------------------------------------------------------------------


def listed(api, db, user, **params) -> dict:
    res = api.get("/api/v1/candidates", headers=h(db, user), params=params)
    assert res.status_code == 200, res.text
    return res.json()


def test_each_tier_sees_its_own_candidates(api, db, world):
    w = world
    assert names(listed(api, db, w["recruiter"])["data"]) == {"Ada Pipe"}
    assert {"Ada Pipe", "Cy Pipe"} <= names(listed(api, db, w["supervisor"])["data"]) and "Bo Pipe" not in names(listed(api, db, w["supervisor"], pageSize="100")["data"])
    assert "Bo Pipe" not in names(listed(api, db, w["inhouse"], pageSize="100")["data"])
    assert {"Ada Pipe", "Bo Pipe"} <= names(listed(api, db, add_user(db, Role.hr), q="Pipe", pageSize="100")["data"])


def test_a_listed_candidate_has_the_websites_fields(api, db, world):
    body = listed(api, db, world["recruiter"])
    assert set(body) == {"data", "total", "page", "pageSize"} and body["pageSize"] == 15
    row = body["data"][0]
    assert {"user", "recruiter", "country", "partner", "referral_agent", "documents", "applications", "screening_result"} <= set(row)
    assert row["country"]["region"]["id"] == world["region"].id
    assert row["applications"] == [{"job": {"title": world["job"].title}, "preferred_sector": None, "preferred_country_1": None}]
    assert ISO_Z.fullmatch(row["created_at"])


def test_the_list_filters_and_sorts(api, db, world):
    hr = add_user(db, Role.hr)
    assert names(listed(api, db, hr, q=world["account"].email.upper())["data"]) == {"Ada Pipe"}  # the account's address
    assert names(listed(api, db, hr, q="orchard programme", pageSize="100")["data"]) == {"Ada Pipe"}  # the job title
    assert names(listed(api, db, hr, q="Pipe", source="self_registered,partner_sourced", pageSize="100")["data"]) == {"Ada Pipe", "Cy Pipe"}
    assert names(listed(api, db, hr, q="Pipe", status="identified", pageSize="100")["data"]) == {"Bo Pipe", "Cy Pipe"}  # Cy by default
    ordered = [r["full_name"] for r in listed(api, db, hr, q="Pipe", sortBy="full_name", sortDir="asc", pageSize="100")["data"]]
    assert ordered == sorted(ordered)
    assert api.get("/api/v1/candidates", headers=h(db, hr), params={"status": "bogus"}).status_code == 422


def test_the_opportunity_filter_and_its_options(api, db, world):
    hr = add_user(db, Role.hr)
    body = listed(api, db, hr, programme="Orchard Programme", filterOptions="true", pageSize="100")
    assert names(body["data"]) == {"Ada Pipe"}
    assert "Orchard Programme" in body["filter_options"]["programmes"] and world["home"].name in body["filter_options"]["countries"]


def test_hrs_attention_signals(api, db, world):
    body = listed(api, db, add_user(db, Role.hr), q="Ada Pipe", signals="true")
    row = body["data"][0]
    assert (row["pending_documents_count"], row["message_count"], row["awaiting_hr_reply"]) == (1, 1, True)
    assert body["summary"] == {"ready_for_approval_count": 1, "awaiting_reply_count": 1}


def test_the_report_window_returns_every_row(api, db, world):
    body = listed(api, db, world["recruiter"], period_start="2000-01-01", period_end="2100-01-01")
    assert set(body) == {"data"} and names(body["data"]) == {"Ada Pipe"}


def test_a_candidate_in_detail(api, db, world):
    d = data(api.get(f"/api/v1/candidates/{world['mine'].id}", headers=h(db, world["supervisor"])))
    assert d["required_document_types"] == [world["passport"].key, world["visa"].key]
    assert d["applications"][0]["required_document_types"] == [world["passport"].key, world["visa"].key]  # the job's country, by name
    assert d["applications"][0]["case"] is None and "screening_failures" not in d
    assert api.get(f"/api/v1/candidates/{world['theirs'].id}", headers=h(db, world["supervisor"])).status_code == 403
    failed = data(api.get(f"/api/v1/candidates/{world['theirs'].id}", headers=h(db, add_user(db, Role.admin))))
    assert failed["screening_failures"]


def test_the_message_thread(api, db, world):
    rows = data(api.get(f"/api/v1/candidates/{world['mine'].id}/messages", headers=h(db, world["account"])))
    assert [m["body"] for m in rows] == ["Hello?"] and rows[0]["sender"]["role"] == "candidate"
    assert api.get(f"/api/v1/candidates/{world['mine'].id}/messages", headers=h(db, world["other_recruiter"])).status_code == 403
    assert api.get("/api/v1/candidates/nope/messages", headers=h(db, world["account"])).status_code == 404


def test_a_candidates_own_profile(api, db, world):
    d = data(api.get("/api/v1/candidates/profile", headers=h(db, world["account"])))
    assert d["id"] == world["mine"].id and d["_count"] == {"applications": 1} and set(d["user"]) == {"full_name", "email", "phone", "country"}
    res = api.get("/api/v1/candidates/profile", headers=h(db, add_user(db, Role.candidate)))
    assert (res.status_code, res.json()["error"]["message"]) == (404, "Profile not found.")


# --- applications ------------------------------------------------------------------------


def test_the_application_lists(api, db, world):
    staff = api.get("/api/v1/applications", headers=h(db, world["recruiter"])).json()
    assert set(staff) == {"data", "total", "page", "pageSize"} and staff["pageSize"] == 50
    assert [a["candidate"]["full_name"] for a in staff["data"]] == ["Ada Pipe"]
    own = data(api.get("/api/v1/applications", headers=h(db, world["account"])))
    assert own[0]["required_document_types"] == [world["passport"].key, world["visa"].key] and "salary_range" in own[0]["job"]
    assert data(api.get("/api/v1/applications", headers=h(db, add_user(db, Role.candidate)))) is None


@pytest.mark.parametrize(("who", "code"), [("account", 200), ("director", 200), ("inhouse", 200), ("other_inhouse", 403), ("recruiter", 403)])
def test_who_opens_an_application(api, db, world, who, code):
    user = {"director": lambda: add_user(db, Role.director), "other_inhouse": lambda: add_user(db, Role.inhouse_supervisor)}.get(who, lambda: world[who])()
    res = api.get(f"/api/v1/applications/{world['application'].id}", headers=h(db, user))
    assert res.status_code == code
    if code == 200:
        d = res.json()["data"]
        assert d["candidate"]["user"] == {"full_name": world["account"].full_name, "email": world["account"].email} and d["job"]["id"] == world["job"].id


def test_q3_an_inhouse_supervisor_is_held_to_their_countries(api, db, world):
    assert api.get(f"/api/v1/applications/{world['away_application'].id}", headers=h(db, world["inhouse"])).status_code == 403


# --- a partner's own -----------------------------------------------------------------------


def test_a_partners_own_submissions(api, db, world):
    body = api.get("/api/v1/partner/candidates", headers=h(db, world["partner_user"])).json()
    assert names(body["data"]) == {"Cy Pipe", "Draft Pipe"}  # its drafts too, never the rival's
    cy = next(r for r in body["data"] if r["full_name"] == "Cy Pipe")
    assert (cy["has_rejected_document"], cy["awaiting_partner_reply"]) == (True, False)
    assert body["summary"] == {"needs_attention_count": 1}
    d = data(api.get(f"/api/v1/partner/candidates/{world['submitted'].id}", headers=h(db, world["partner_user"])))
    assert d["bridged_candidate"]["documents"][0]["verification_status"] == "rejected" and d["job"]["payment_stages"] == []
    res = api.get(f"/api/v1/partner/candidates/{world['rivals'].id}", headers=h(db, world["partner_user"]))
    assert (res.status_code, res.json()["error"]["message"]) == (404, "Submission not found.")
    assert api.get("/api/v1/partner/candidates", headers=h(db, add_user(db, Role.partner))).status_code == 404


# --- HR's queue (Q2: global) ------------------------------------------------------------------


@pytest.mark.parametrize("role", [Role.hr, Role.operations_team, Role.operations_director])
def test_q2_the_queue_is_global_and_never_shows_drafts(api, db, world, role):
    body = api.get("/api/v1/partner-candidates", headers=h(db, add_user(db, role)), params={"q": "Pipe", "pageSize": "100"}).json()
    assert {"Cy Pipe", "Rival Pipe"} <= names(body["data"]) and "Draft Pipe" not in names(body["data"])
    assert set(body) == {"data", "total", "page", "pageSize", "summary", "filter_options"}
    assert data(api.get("/api/v1/partner-candidates", headers=h(db, add_user(db, role)), params={"status": "draft"})) == []


def test_the_queue_rows_and_detail(api, db, world):
    hr = h(db, add_user(db, Role.hr))
    body = api.get("/api/v1/partner-candidates", headers=hr, params={"q": world["partner"].name, "sortBy": "partner"}).json()
    cy = next(r for r in body["data"] if r["full_name"] == "Cy Pipe")
    assert cy["partner"]["name"] == world["partner"].name and cy["awaiting_hr_reply"] is True
    # No applications: only the universal passport is needed, and one was
    # uploaded (completeness counts uploads, whatever their review status).
    assert cy["document_completeness"] == {"complete": True, "missingTypes": []}
    detail = data(api.get(f"/api/v1/partner-candidates/{world['submitted'].id}", headers=hr))
    assert detail["required_document_types"] == [world["passport"].key, world["visa"].key] and detail["reviewer"] is None
    res = api.get(f"/api/v1/partner-candidates/{world['draft'].id}", headers=hr)
    assert (res.status_code, res.json()["error"]["message"]) == (404, "Partner candidate submission not found.")


def test_a_refused_record_is_on_the_audit_trail(api, db, world, caplog):
    # Gap G7: the website's forbidden() recorded these; FastAPI's ApiError
    # handler does the same for every route's own refusal of one record.
    import logging

    with caplog.at_level(logging.WARNING, logger="vertex"):
        assert api.get(f"/api/v1/applications/{world['away_application'].id}", headers=h(db, world["inhouse"])).status_code == 403
    [record] = [r for r in caplog.records if getattr(r, "event", None) == "security.access_denied"]
    assert (record.fields["reason"], record.fields["role"], record.fields["actor_id"]) == ("record", "inhouse_supervisor", world["inhouse"].id)
    assert record.fields["path"] == f"/api/v1/applications/{world['away_application'].id}"


# --- moved from the website's integration tests ------------------------------------------
# partner-drafts.integration.test.ts and resource-authorization.integration.test.ts
# (pipeline stage 5: swapping the ID in the URL never reaches another user's record).


def test_a_partner_reopens_its_own_draft_and_no_one_elses(api, db, world):
    own = data(api.get(f"/api/v1/partner/candidates/{world['draft'].id}", headers=h(db, world["partner_user"])))
    assert (own["status"], own["full_name"]) == ("draft", "Draft Pipe")
    other_partner = add_user(db, Role.partner)
    db.add(Partner(name=f"Other Agency {tag()}", partner_type="travel_agency", country_of_operation="Kenya", contact_name="C",
                   contact_email=f"oa-{tag()}@test.invalid", contact_phone="+1", user_id=other_partner.id))
    db.flush()
    assert api.get(f"/api/v1/partner/candidates/{world['draft'].id}", headers=h(db, other_partner)).status_code == 404
    assert "Draft Pipe" not in names(data(api.get("/api/v1/partner/candidates", headers=h(db, other_partner))))


def test_another_candidate_cant_reach_this_ones_records(api, db, world):
    intruder_user = add_user(db, Role.candidate)
    db.add(Candidate(full_name="Intruder", user_id=intruder_user.id))
    db.flush()
    intruder = h(db, intruder_user)
    assert api.get(f"/api/v1/applications/{world['application'].id}", headers=intruder).status_code == 403
    assert api.get(f"/api/v1/candidates/{world['mine'].id}/messages", headers=intruder).status_code == 403
    assert api.get(f"/api/v1/applications/{world['application'].id}").status_code == 401
