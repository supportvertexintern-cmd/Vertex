"""Reads handover R5: cases, a case's contract and history, exceptions,
rejected submissions and a document's download link
(app/api/v1/case_reads.py). Each answers as the website's Prisma read did:
the same rows for the same caller, the same filters and JSON keys. The
audit trail is read through migration 0008's functions only: a case's
history carries no snapshots, and the rejection dates are the trail's."""

import logging
import secrets
from datetime import datetime

import pytest

from app.api.v1.case_reads import CASE_READERS, REJECTED_READERS
from app.core.config import settings
from app.core.rbac import STAFF_ROLES
from app.db.session import get_db
from app.main import app
from app.models.audit import AuditLog
from app.models.candidate import Application, Candidate, Document
from app.models.cases import Case, CaseReminder, CaseStageEvent, Contract
from app.models.enums import (
    CandidateLifecycleStatus as L,
    CandidateSource,
    CaseReminderChannel,
    CaseStage,
    CaseStatus,
    EscalationLevel,
    ExceptionCategory,
    PartnerCandidateStatus as PS,
    Role,
)
from app.models.identity import Country, InhouseCountryAssignment, Region, User
from app.models.jobs import Job
from app.models.partners import Partner, PartnerCandidate
from app.models.reference import DocumentRequirementType
from app.models.reporting import ExceptionReport
from tests.test_auth import add_session, bearer, session_token
from tests.test_service_auth import SERVICE_SECRET, service_token


@pytest.fixture(autouse=True)
def website_secret(monkeypatch):
    monkeypatch.setattr(settings, "SERVICE_AUTH_SECRET", SERVICE_SECRET)
    monkeypatch.setattr(settings, "SERVICE_AUTH_SECRET_PREVIOUS", None)


@pytest.fixture
def api(db, client):
    app.dependency_overrides[get_db] = lambda: db
    yield client
    app.dependency_overrides.pop(get_db, None)


def tag() -> str:
    return secrets.token_hex(3)


def add_user(db, role: Role, **fields) -> User:
    u = User(full_name=f"Case {role.value} {tag()}", email=f"case-{tag()}@test.invalid", role=role, **fields)
    db.add(u)
    db.flush()
    db.refresh(u)
    return u


def h(db, user: User) -> dict[str, str]:
    s = add_session(db, user.id)
    return bearer(session_token(user.id, s.family_id, user.token_version))


def data(res):
    assert res.status_code == 200, res.text
    return res.json()["data"]


def trail(db, entity_type: str, entity_id: str, action: str, at: datetime, actor: str | None = None, before=None, after=None) -> AuditLog:
    row = AuditLog(entity_type=entity_type, entity_id=entity_id, action=action, actor_id=actor, created_at=at, before=before, after=after)
    db.add(row)
    db.flush()
    return row


@pytest.fixture
def world(db):
    region = Region(name=f"Caseregion {tag()}")
    db.add(region)
    db.flush()
    home = Country(name=f"Casehome {tag()}", region_id=region.id)
    away = Country(name=f"Caseaway {tag()}", region_id=region.id)
    passport = DocumentRequirementType(key=f"case_passport_{tag()}", label="Passport")
    photo = DocumentRequirementType(key=f"case_photo_{tag()}", label="Photo")
    db.add_all([home, away, passport, photo])
    db.flush()
    recruiter = add_user(db, Role.regional_recruiter, assigned_country_id=home.id)
    other_recruiter = add_user(db, Role.regional_recruiter, assigned_country_id=away.id)
    supervisor = add_user(db, Role.country_supervisor, assigned_country_id=home.id)
    inhouse = add_user(db, Role.inhouse_supervisor)
    db.add(InhouseCountryAssignment(inhouse_supervisor_id=inhouse.id, country_id=home.id))
    ops = add_user(db, Role.operations_team)
    hr = add_user(db, Role.hr)
    account = add_user(db, Role.candidate)
    partner_user = add_user(db, Role.partner)
    partner = Partner(name=f"Case Agency {tag()}", partner_type="travel_agency", country_of_operation="Kenya", contact_name="C",
                      contact_email=f"ca-{tag()}@test.invalid", contact_phone="+1", user_id=partner_user.id)
    db.add(partner)
    job = Job(title=f"{home.name} — Orchard Programme {tag()}", country=home.name.upper(), city="Town",
              job_description="Seasonal orchard work.", requirements="None.")
    db.add(job)
    db.flush()
    mine = Candidate(full_name="Ada Case", country_id=home.id, recruiter_id=recruiter.id, user_id=account.id,
                     source=CandidateSource.self_registered, lifecycle_status=L.approved)
    theirs = Candidate(full_name="Bo Case", country_id=away.id, recruiter_id=other_recruiter.id, partner_id=partner.id,
                       source=CandidateSource.partner_sourced, lifecycle_status=L.approved)
    db.add_all([mine, theirs])
    db.flush()
    mine_app = Application(candidate_id=mine.id, job_id=job.id)
    theirs_app = Application(candidate_id=theirs.id)
    db.add_all([mine_app, theirs_app])
    db.flush()
    case = Case(application_id=mine_app.id, current_stage=CaseStage.document_preparation_legalization, created_at=datetime(2026, 10, 1))
    closed = Case(application_id=theirs_app.id, status=CaseStatus.rejected, rejected_at=datetime(2026, 10, 20), rejection_reason="Withdrew",
                  created_at=datetime(2026, 9, 1))
    db.add_all([case, closed])
    db.flush()
    first = CaseStageEvent(case_id=case.id, stage=CaseStage.registration_document_submission, owner_id=ops.id, entered_at=datetime(2026, 10, 1))
    second = CaseStageEvent(case_id=case.id, stage=CaseStage.document_preparation_legalization, entered_at=datetime(2026, 10, 5))
    db.add_all([second, first])
    db.add(Document(candidate_id=mine.id, type=passport.key, storage_path=f"docs/{tag()}.pdf", uploaded_at=datetime(2026, 9, 1)))
    db.add(Document(candidate_id=mine.id, type=photo.key, storage_path=f"docs/{tag()}.jpg", uploaded_at=datetime(2026, 9, 2)))
    db.flush()
    return {k: v for k, v in locals().items() if k != "db"}


# --- roles --------------------------------------------------------------------------


@pytest.mark.parametrize("role", list(Role))
def test_who_may_read(api, db, world, role):
    headers = h(db, add_user(db, role))
    for path, readers in (("/api/v1/cases", CASE_READERS), ("/api/v1/exceptions", STAFF_ROLES), ("/api/v1/rejected-submissions", REJECTED_READERS)):
        assert api.get(path, headers=headers).status_code == (200 if role in readers else 403), (path, role)
    assert api.get("/api/v1/cases").status_code == 401


def test_the_readers_are_the_websites():
    # The website's CASE_ACCESS_ROLES and REJECTED_SUBMISSION_ROLES.
    assert {r.value for r in CASE_READERS} == {
        "candidate", "regional_recruiter", "country_supervisor", "inhouse_supervisor", "director", "admin", "partner", "hr",
        "operations_team", "operations_director", "finance",
    }
    assert set(CASE_READERS) - set(REJECTED_READERS) == {Role.candidate, Role.partner}


# --- cases ---------------------------------------------------------------------------


def ids(rows) -> set[str]:
    return {r["id"] for r in rows}


def test_each_caller_sees_the_cases_in_their_scope(api, db, world):
    case, closed = world["case"].id, world["closed"].id
    every = {"status": "all"}
    assert ids(data(api.get("/api/v1/cases", params=every, headers=h(db, world["recruiter"])))) == {case}
    assert ids(data(api.get("/api/v1/cases", params=every, headers=h(db, world["other_recruiter"])))) == {closed}
    assert ids(data(api.get("/api/v1/cases", params=every, headers=h(db, world["account"])))) == {case}
    assert ids(data(api.get("/api/v1/cases", params=every, headers=h(db, world["partner_user"])))) == {closed}
    assert ids(data(api.get("/api/v1/cases", params=every, headers=h(db, world["inhouse"])))) == {case}
    assert {case, closed} <= ids(data(api.get("/api/v1/cases", params=every | {"pageSize": "200"}, headers=h(db, world["ops"]))))


def test_the_case_list_filters_searches_sorts_and_pages(api, db, world):
    hdr = h(db, world["ops"])
    cand = {"candidate_id": world["mine"].id}

    def listed(**params):
        return ids(data(api.get("/api/v1/cases", params=params, headers=hdr)))

    # Rejected cases drop out unless asked for.
    assert listed(candidate_id=world["theirs"].id) == set()
    assert listed(candidate_id=world["theirs"].id, status="rejected") == {world["closed"].id}
    assert listed(**cand, stage="document_preparation_legalization") == {world["case"].id}
    assert listed(**cand, stage="registration_document_submission") == set()
    assert listed(source="partner_sourced", status="all", partner_id=world["partner"].id) == {world["closed"].id}
    assert listed(country_id=world["home"].id) == {world["case"].id}
    assert listed(q="ada case") == {world["case"].id}
    assert listed(q="orchard programme", country_id=world["home"].id) == {world["case"].id}
    assert listed(q=world["partner"].name.upper(), status="all") == {world["closed"].id}
    page = api.get("/api/v1/cases", params={"status": "all", "q": "Case", "sortBy": "created_at", "sortDir": "asc", "pageSize": "1"}, headers=hdr).json()
    assert (page["page"], page["pageSize"], page["total"] >= 2) == (1, 1, True)
    assert api.get("/api/v1/cases", params={"stage": "flying"}, headers=hdr).status_code == 422
    assert api.get("/api/v1/cases", params={"source": "word_of_mouth"}, headers=hdr).status_code == 422


def test_a_listed_case_has_the_websites_keys(api, db, world):
    [row] = data(api.get("/api/v1/cases", params={"candidate_id": world["mine"].id, "filterOptions": "true"}, headers=h(db, world["ops"])))
    assert {"id", "current_stage", "status", "ops_review_status", "created_at", "application", "contract", "payments", "retention_follow_up"} <= row.keys()
    candidate = row["application"]["candidate"]
    assert (candidate["full_name"], candidate["user"].keys(), candidate["country"]["name"], candidate["recruiter"].keys()) == (
        "Ada Case", {"full_name", "email"}, world["home"].name, {"full_name"})
    assert row["application"]["job"].keys() == {"title", "country", "city"}
    assert row["created_at"] == "2026-10-01T00:00:00.000Z"
    options = api.get("/api/v1/cases", params={"filterOptions": "true"}, headers=h(db, world["ops"])).json()["filter_options"]
    assert world["home"].name.upper() in options["countries"]


def test_a_case_in_detail(api, db, world):
    hdr = h(db, world["recruiter"])
    c = data(api.get(f"/api/v1/cases/{world['case'].id}", headers=hdr))
    assert [e["stage"] for e in c["stage_events"]] == ["registration_document_submission", "document_preparation_legalization"]
    assert c["stage_events"][0]["owner"] == {"full_name": world["ops"].full_name}
    assert [d["type"] for d in c["application"]["candidate"]["documents"]] == [world["photo"].key, world["passport"].key]
    assert c["application"]["candidate"]["recruiter"] == {"id": world["recruiter"].id, "full_name": world["recruiter"].full_name}
    assert c["application"]["job"]["payment_stages"] == []
    assert (c["contract"], c["payments"], c["retention_follow_up"], c["rejected_by"]) == (None, [], None, None)
    other = api.get(f"/api/v1/cases/{world['closed'].id}", headers=hdr)
    assert (other.status_code, other.json()["error"]["message"]) == (403, "Forbidden.")
    missing = api.get("/api/v1/cases/nope", headers=hdr)
    assert (missing.status_code, missing.json()["error"]["message"]) == (404, "Case not found.")


def test_a_cases_contract(api, db, world):
    hdr = h(db, world["account"])
    none_yet = api.get(f"/api/v1/cases/{world['case'].id}/contract", headers=hdr)
    assert (none_yet.status_code, none_yet.json()["error"]["message"]) == (404, "No contract yet.")
    db.add(Contract(case_id=world["case"].id, content="Terms.", created_by=world["ops"].id))
    db.flush()
    db.expire_all()
    assert data(api.get(f"/api/v1/cases/{world['case'].id}/contract", headers=hdr))["content"] == "Terms."
    assert api.get(f"/api/v1/cases/{world['closed'].id}/contract", headers=hdr).status_code == 403


# --- a case's history (vertex_case_trail) ----------------------------------------------------------------


def test_a_cases_history_comes_from_the_trail_without_snapshots(api, db, world):
    case = world["case"]
    event = case.stage_events[0]
    # The fixture's own inserts are on the trail too (as System, at the
    # time they ran); these are the rows this test follows.
    mine = [
        trail(db, "Case", case.id, "update", datetime(2026, 10, 1, 9), actor=world["ops"].id, after={"passport_number": "X123"}).id,
        trail(db, "CaseStageEvent", event.id, "update", datetime(2026, 10, 5, 9)).id,
    ]
    others = [
        trail(db, "Case", world["closed"].id, "update", datetime(2026, 10, 6)).id,  # another case's
        trail(db, "Candidate", case.application.candidate_id, "update", datetime(2026, 10, 6)).id,  # not the case's
    ]
    reminder = CaseReminder(case_id=case.id, channel=CaseReminderChannel.document, recipient="ada@test.invalid", message="Passport, please",
                        sent_by=world["ops"].id, sent_at=datetime(2026, 10, 3))
    db.add(reminder)
    db.flush()
    db.expire_all()

    every = data(api.get(f"/api/v1/cases/{case.id}/audit-log", headers=h(db, world["recruiter"])))
    assert {"Case opened", "Stage advanced"} <= {r["summary"] for r in every}  # the fixture's creates
    assert not {r["id"] for r in every} & set(others)
    assert [r["timestamp"] for r in every] == sorted(r["timestamp"] for r in every)
    rows = [r for r in every if r["id"] in mine or r["id"] == reminder.id]
    assert [(r["kind"], r["summary"], r["actorName"], r["actorRole"]) for r in rows] == [
        ("audit", "Case updated", world["ops"].full_name, "operations_team"),
        ("reminder", 'Reminder sent (document) to ada@test.invalid: "Passport, please"', world["ops"].full_name, "operations_team"),
        ("audit", "Stage event updated", "System", None),
    ]
    assert rows[0]["timestamp"] == "2026-10-01T09:00:00.000Z"
    assert all(r.keys() == {"id", "kind", "summary", "actorName", "actorRole", "timestamp"} for r in every)
    refused = api.get(f"/api/v1/cases/{case.id}/audit-log", headers=h(db, world["other_recruiter"]))
    assert (refused.status_code, refused.json()["error"]["code"]) == (403, "forbidden")
    assert api.get("/api/v1/cases/nope/audit-log", headers=h(db, world["ops"])).status_code == 404


# --- exceptions ------------------------------------------------------------------------


def raise_exception(db, raiser: User, country: Country | None, **fields) -> ExceptionReport:
    e = ExceptionReport(
        reference=f"EXC-{tag()}", category=fields.pop("category", ExceptionCategory.other), raised_by=raiser.id, role_at_raise=raiser.role,
        country_id=country.id if country else None, issue_statement=fields.pop("issue_statement", "Visa slots ran out"),
        immediate_impact="Delays", decision_required="Extend?", decision_deadline=datetime(2026, 12, 1), **fields,
    )
    db.add(e)
    db.flush()
    return e


def test_exceptions_by_tier_with_filters(api, db, world):
    own = raise_exception(db, world["recruiter"], world["home"])
    home = raise_exception(db, world["other_recruiter"], world["home"], escalation_level=EscalationLevel.country,
                           category=ExceptionCategory.crm_system_issue, candidate_id=world["mine"].id)
    away = raise_exception(db, world["other_recruiter"], world["away"], issue_statement="Flights cancelled")

    def listed(user: User, **params):
        return ids(data(api.get("/api/v1/exceptions", params=params | {"pageSize": "100"}, headers=h(db, user))))

    assert listed(world["recruiter"]) == {own.id}
    assert listed(world["supervisor"]) >= {own.id, home.id} and away.id not in listed(world["supervisor"])
    assert listed(world["inhouse"]) >= {own.id, home.id} and away.id not in listed(world["inhouse"])
    director = add_user(db, Role.director)
    assert {own.id, home.id, away.id} <= listed(director)
    assert listed(director, escalation_level="country", category="crm_system_issue") >= {home.id}
    assert own.id not in listed(director, escalation_level="country")
    assert listed(director, q="ada case") >= {home.id} and own.id not in listed(director, q="ada case")
    assert listed(director, q=away.reference.lower()) == {away.id}
    [row] = data(api.get("/api/v1/exceptions", params={"q": home.reference}, headers=h(db, director)))
    assert (row["raiser"]["role"], row["candidate"]["full_name"], row["country"]["name"], row["corrective_actions"]) == (
        "regional_recruiter", "Ada Case", world["home"].name, [])
    assert api.get("/api/v1/exceptions", params={"status": "pending"}, headers=h(db, director)).status_code == 422


# --- rejected submissions (vertex_rejection_dates) ----------------------------------------------------------


def test_rejected_submissions_with_the_trails_dates(api, db, world):
    rejected_pc = PartnerCandidate(partner_id=world["partner"].id, status=PS.rejected, full_name="Rejected Pc", job_id=world["job"].id,
                                   rejection_reason="Incomplete")
    walk_in = Candidate(full_name="Walk In", source=CandidateSource.referral_sourced, lifecycle_status=L.rejected, return_reason="Too young")
    db.add_all([rejected_pc, walk_in])
    db.flush()
    trail(db, "PartnerCandidate", rejected_pc.id, "update", datetime(2026, 10, 10), before={"status": "submitted"}, after={"status": "rejected"})
    # Later edits of an already rejected row don't move the date.
    trail(db, "PartnerCandidate", rejected_pc.id, "update", datetime(2026, 10, 25), before={"status": "rejected"}, after={"status": "rejected"})
    trail(db, "Candidate", walk_in.id, "update", datetime(2026, 10, 15), before={"lifecycle_status": "submitted"}, after={"lifecycle_status": "rejected"})
    db.flush()

    rows = {r["id"]: r for r in data(api.get("/api/v1/rejected-submissions", headers=h(db, world["hr"])))}
    pc, me, case = rows[rejected_pc.id], rows[walk_in.id], rows[world["closed"].id]
    assert (pc["type"], pc["rejected_at"], pc["partner"], pc["reason"], pc["opportunity"]) == (
        "Partner submission", "2026-10-10T00:00:00.000Z", world["partner"].name, "Incomplete", f"{world['job'].title} ({world['job'].country})")
    assert (me["type"], me["rejected_at"], me["reason"], me["opportunity"], me["status"]) == ("Self submission", "2026-10-15T00:00:00.000Z", "Too young", None, "rejected")
    assert (case["type"], case["rejected_at"], case["reason"], case["partner"]) == ("Case", "2026-10-20T00:00:00.000Z", "Withdrew", world["partner"].name)
    order = [r["id"] for r in data(api.get("/api/v1/rejected-submissions", headers=h(db, world["hr"])))]
    assert order.index(world["closed"].id) < order.index(walk_in.id) < order.index(rejected_pc.id)

    # Operations: partner submissions and cases, not self submissions.
    ops = ids(data(api.get("/api/v1/rejected-submissions", headers=h(db, world["ops"]))))
    assert {rejected_pc.id, world["closed"].id} <= ops and walk_in.id not in ops
    # A recruiter: only the cases in their scope.
    assert ids(data(api.get("/api/v1/rejected-submissions", headers=h(db, world["other_recruiter"])))) == {world["closed"].id}
    assert ids(data(api.get("/api/v1/rejected-submissions", headers=h(db, world["recruiter"])))) == set()


def test_a_self_submission_with_a_rejected_case_shows_once(api, db, world):
    theirs = world["theirs"]
    theirs.lifecycle_status, theirs.source = L.rejected, CandidateSource.self_registered
    db.flush()
    rows = data(api.get("/api/v1/rejected-submissions", headers=h(db, world["hr"])))
    assert [r["type"] for r in rows if r["id"] in (theirs.id, world["closed"].id)] == ["Case"]


# --- a document's download link -----------------------------------------------------------------


def website(session: dict[str, str]) -> dict[str, str]:
    return {"X-Vertex-Service": service_token()} | session


def test_a_download_link_is_the_websites_to_sign(api, db, world, caplog):
    doc = world["mine"].documents[0]
    url = f"/api/v1/documents/{doc.id}/link"
    # A signed-in user calling directly never gets the storage key.
    assert api.get(url, headers=h(db, world["recruiter"])).status_code == 401
    with caplog.at_level(logging.INFO, logger="vertex"):
        assert data(api.get(url, headers=website(h(db, world["recruiter"])))) == {"storage_path": doc.storage_path}
    [issued] = [r for r in caplog.records if getattr(r, "event", None) == "security.document_link_issued"]
    assert (issued.fields["actor_id"], issued.fields["entity_id"], issued.fields["candidate_id"]) == (world["recruiter"].id, doc.id, world["mine"].id)
    assert api.get(url, headers=website(h(db, world["other_recruiter"]))).status_code == 403
    assert api.get("/api/v1/documents/nope/link", headers=website(h(db, world["recruiter"]))).status_code == 404


# --- moved from the website's integration tests ------------------------------------------
# resource-authorization.integration.test.ts (pipeline stage 5: swapping the ID
# in the URL never reaches another user's record) and the document_link_issued
# half of security-events.integration.test.ts (above).


@pytest.mark.parametrize("role", [Role.candidate, Role.partner])
def test_swapping_the_id_never_reaches_another_users_case_or_document(api, db, world, role):
    def owner() -> tuple[User, Case, Document]:
        account = add_user(db, role)
        partner = None
        if role is Role.partner:
            partner = Partner(name=f"Idor Agency {tag()}", partner_type="travel_agency", country_of_operation="X", contact_name="C",
                              contact_email=f"ia-{tag()}@test.invalid", contact_phone="+1", user_id=account.id)
            db.add(partner)
            db.flush()
        candidate = Candidate(full_name="Idor", user_id=account.id if role is Role.candidate else None, partner_id=partner.id if partner else None)
        db.add(candidate)
        db.flush()
        application = Application(candidate_id=candidate.id, job_id=world["job"].id)
        db.add(application)
        db.flush()
        case = Case(application_id=application.id)
        doc = Document(candidate_id=candidate.id, type=world["passport"].key, storage_path=f"idor/{tag()}.pdf")
        db.add_all([case, doc])
        db.flush()
        return account, case, doc

    (a, _, _), (b, b_case, b_doc) = owner(), owner()
    for path, as_website in ((f"/api/v1/cases/{b_case.id}", False), (f"/api/v1/cases/{b_case.id}/contract", False),
                             (f"/api/v1/cases/{b_case.id}/audit-log", False), (f"/api/v1/documents/{b_doc.id}/link", True)):
        call = (lambda u: website(h(db, u))) if as_website else (lambda u: h(db, u))  # noqa: E731
        assert api.get(path, headers=call(b)).status_code in (200, 404), path  # 404: no contract yet
        assert api.get(path, headers=call(a)).status_code == 403, path
        assert api.get(path, headers=website({}) if as_website else {}).status_code == 401, path
