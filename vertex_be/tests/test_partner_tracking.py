"""Partner tracking (Phase 6, upstream staging): the panel for one partner,
the reports and follow-ups a VA keeps, the activity feed, the VA team list,
and the partner's onboarding fields. A VA reaches only its own partners,
on every read and write."""

from __future__ import annotations

import re
import secrets
import pytest
from sqlalchemy import select

from app.api.v1.partner_tracking import MANAGERS, TRACKERS
from app.core.clock import utc_now_ms
from app.core.config import BASE_DIR
from app.db.session import get_db
from app.main import app
from app.models.audit import AuditLog
from app.models.candidate import Candidate
from app.models.enums import PartnerCandidateStatus, PartnerStatus, PartnerType, Role
from app.models.identity import User
from app.models.partner_tracking import PartnerFollowUp, PartnerReport
from app.models.partners import Partner, PartnerCandidate
from tests.test_auth import add_session, bearer, session_token
from tests.test_db_roles import roles_provisioned  # noqa: F401  (vertex_api must exist)

URL = "/api/v1"
NEXT_API = BASE_DIR.parent / "vertex" / "src" / "app" / "api"


@pytest.fixture
def api(db, client):
    app.dependency_overrides[get_db] = lambda: db
    yield client
    app.dependency_overrides.pop(get_db, None)


def person(db, role: Role, name: str | None = None) -> tuple[User, dict[str, str]]:
    u = User(full_name=name or f"Tracker {secrets.token_hex(2)}", email=f"pt-{secrets.token_hex(4)}@test.invalid", role=role)
    db.add(u)
    db.flush()
    db.refresh(u)
    return u, bearer(session_token(u.id, add_session(db, u.id).family_id, u.token_version))


def agency(db, keeper: User | None, **fields) -> Partner:
    p = Partner(
        name=fields.pop("name", f"Agency {secrets.token_hex(3)}"), partner_type=PartnerType.manpower_supplier, country_of_operation="Kenya",
        contact_name="Pat", contact_email=f"pt-{secrets.token_hex(3)}@test.invalid", contact_phone="1", status=PartnerStatus.active,
        assigned_team_member_id=keeper.id if keeper else None, **fields,
    )
    db.add(p)
    db.flush()
    return p


@pytest.fixture
def team(db):
    sarah, as_sarah = person(db, Role.virtual_assistant, "Sarah VA")
    daniel, as_daniel = person(db, Role.virtual_assistant, "Daniel VA")
    _, director = person(db, Role.director)
    _, hr = person(db, Role.hr)
    return {
        "sarah": sarah, "as_sarah": as_sarah, "daniel": daniel, "as_daniel": as_daniel, "director": director, "hr": hr,
        "hers": agency(db, sarah, name="Sarah's Agency"), "his": agency(db, daniel, name="Daniel's Agency"),
    }


def error(res) -> dict:
    return res.json()["error"]


# --- who reaches what ----------------------------------------------------------


def next_roles(route: str) -> set[str]:
    src = (NEXT_API / route / "route.ts").read_text(encoding="utf-8")
    return set(re.findall(r'"(\w+)"', re.search(r"requireRole\(user, \[(.*?)\]\)", src, re.S).group(1)))


def test_the_roles_match_next_js():
    for route in ("management/partners/[id]/tracking", "partner-reports", "partner-reports/[id]", "partner-follow-ups", "partner-follow-ups/[id]"):
        assert next_roles(route) == {r.value for r in TRACKERS}, route
    assert next_roles("admin/va-users") == {r.value for r in MANAGERS}


def test_a_va_tracks_only_its_own_partners(api, team):
    assert api.get(f"{URL}/partners/{team['hers'].id}/tracking", headers=team["as_sarah"]).status_code == 200
    refused = api.get(f"{URL}/partners/{team['his'].id}/tracking", headers=team["as_sarah"])
    assert (refused.status_code, error(refused)["message"]) == (403, "This partner is not assigned to you.")
    assert api.get(f"{URL}/partners/{team['his'].id}/tracking", headers=team["director"]).status_code == 200
    assert api.get(f"{URL}/partners/{team['his'].id}/tracking", headers=team["hr"]).status_code == 403
    assert api.get(f"{URL}/partners/no-such/tracking", headers=team["director"]).status_code == 404


def test_a_refusal_is_on_the_audit_trail(api, db, team):
    api.get(f"{URL}/partners/{team['his'].id}/tracking", headers=team["as_sarah"])
    denied = db.scalars(select(AuditLog).where(AuditLog.action == "access_denied", AuditLog.actor_id == team["sarah"].id)).all()
    assert any(team["his"].id in (d.entity_id or "") for d in denied)


def test_a_va_writes_only_for_its_own_partners(api, db, team):
    # Upstream's DEF-013: viewing and creating were scoped, editing wasn't.
    theirs = PartnerReport(partner_id=team["his"].id, reported_at=utc_now_ms(), content={"notes": "His"})
    task = PartnerFollowUp(partner_id=team["his"].id, action="Chase MOU")
    db.add_all([theirs, task])
    db.flush()
    s = team["as_sarah"]
    assert api.post(f"{URL}/partner-reports", headers=s, json={"partner_id": team["his"].id, "content": "Mine now"}).status_code == 403
    assert api.patch(f"{URL}/partner-reports/{theirs.id}", headers=s, json={"status": "closed"}).status_code == 403
    assert api.post(f"{URL}/partner-follow-ups", headers=s, json={"partner_id": team["his"].id, "action": "Call them"}).status_code == 403
    assert api.patch(f"{URL}/partner-follow-ups/{task.id}", headers=s, json={"status": "done"}).status_code == 403
    db.refresh(theirs)
    db.refresh(task)
    assert (theirs.status.value, task.status.value) == ("pending", "open")


# --- the panel -------------------------------------------------------------------


def test_the_panel_counts_the_partners_submissions(api, db, team):
    p = team["hers"]
    for s in (PartnerCandidateStatus.draft, PartnerCandidateStatus.submitted, PartnerCandidateStatus.under_review,
              PartnerCandidateStatus.job_assigned, PartnerCandidateStatus.rejected, PartnerCandidateStatus.job_assigned):
        db.add(PartnerCandidate(partner_id=p.id, full_name="Someone", status=s,
                                drafted_at=utc_now_ms(), submitted_at=None if s is PartnerCandidateStatus.draft else utc_now_ms()))
    db.add_all([Candidate(full_name="Bridged one", partner_id=p.id), Candidate(full_name="Bridged two", partner_id=p.id)])
    db.add(PartnerCandidate(partner_id=team["his"].id, full_name="Not hers", status=PartnerCandidateStatus.submitted))
    db.flush()
    data = api.get(f"{URL}/partners/{p.id}/tracking", headers=team["as_sarah"]).json()["data"]
    s = data["stats"]
    assert (s["registered"], s["initiated"], s["submitted"], s["under_review"], s["approved"], s["rejected_or_withdrawn"]) == (2, 6, 5, 1, 2, 1)
    assert s["first_activity_at"] is not None and s["last_activity_at"] is not None
    assert data["partner"]["assigned_team_member"] == {"id": team["sarah"].id, "full_name": "Sarah VA"}


# --- reports ---------------------------------------------------------------------


def test_a_report_needs_notes_and_is_kept_as_notes(api, db, team):
    s = team["as_sarah"]
    for blank in ("", "  ", "x"):
        res = api.post(f"{URL}/partner-reports", headers=s, json={"partner_id": team["hers"].id, "content": blank})
        assert res.status_code == 422, blank  # upstream's DEF-011: no empty rows
    made = api.post(f"{URL}/partner-reports", headers=s, json={"partner_id": team["hers"].id, "content": "  Sourced 12 in Addis  "})
    assert made.status_code == 201
    row = made.json()["data"]
    assert (row["content"], row["status"], row["submitted_by"]) == ({"notes": "Sourced 12 in Addis"}, "submitted", team["sarah"].id)
    closed = api.patch(f"{URL}/partner-reports/{row['id']}", headers=s, json={"status": "closed"}).json()["data"]
    assert (closed["status"], closed["content"]) == ("closed", {"notes": "Sourced 12 in Addis"})
    assert api.patch(f"{URL}/partner-reports/no-such", headers=s, json={"status": "closed"}).status_code == 404


# --- follow-ups ------------------------------------------------------------------


def test_a_follow_up_has_its_due_date_and_is_completed(api, db, team):
    s = team["as_sarah"]
    made = api.post(f"{URL}/partner-follow-ups", headers=s,
                    json={"partner_id": team["hers"].id, "action": "Chase the signed MOU", "due_at": "2026-12-01T00:00:00Z"})
    assert made.status_code == 201
    row = made.json()["data"]
    # Upstream's DEF-012: the date is kept; the assignee defaults to whoever recorded it.
    assert (row["due_at"], row["assigned_team_member"], row["status"]) == ("2026-12-01T00:00:00.000Z", team["sarah"].id, "open")
    done = api.patch(f"{URL}/partner-follow-ups/{row['id']}", headers=s, json={"status": "done"}).json()["data"]
    assert (done["status"], done["completed_at"] is not None) == ("done", True)
    reopened = api.patch(f"{URL}/partner-follow-ups/{row['id']}", headers=s, json={"status": "open", "due_at": None}).json()["data"]
    assert (reopened["status"], reopened["completed_at"], reopened["due_at"]) == ("open", None, None)


def test_a_follow_up_goes_to_an_active_colleague(api, db, team):
    gone, _ = person(db, Role.virtual_assistant)
    gone.deactivated_at = utc_now_ms()
    db.flush()
    for assignee in (gone.id, "no-such-user"):
        res = api.post(f"{URL}/partner-follow-ups", headers=team["director"], json={"partner_id": team["his"].id, "action": "Call", "assigned_team_member": assignee})
        assert (res.status_code, error(res)["message"]) == (422, "Assigned team member must be an active user."), assignee
    ok = api.post(f"{URL}/partner-follow-ups", headers=team["director"], json={"partner_id": team["his"].id, "action": "Call", "assigned_team_member": team["daniel"].id})
    assert ok.json()["data"]["assignee"] == {"full_name": "Daniel VA"}


# --- the activity feed -------------------------------------------------------------


def test_the_feed_is_the_partners_own_history_in_sentences(api, db, team):
    s = team["as_sarah"]
    report = api.post(f"{URL}/partner-reports", headers=s, json={"partner_id": team["hers"].id, "content": "First report", "status": "pending"}).json()["data"]
    api.patch(f"{URL}/partner-reports/{report['id']}", headers=s, json={"status": "closed"})
    api.post(f"{URL}/partner-reports", headers=team["as_daniel"], json={"partner_id": team["his"].id, "content": "Someone else's"})
    feed = api.get(f"{URL}/partners/{team['hers'].id}/tracking", headers=s).json()["data"]["activity"]
    summaries = [(a["entity"], a["summary"], a["actor"]) for a in feed]
    assert ("Report", "Status: pending → closed", "Sarah VA") in summaries
    assert ("Report", "Created report", "Sarah VA") in summaries
    assert ("Partner", "Created partner", None) in summaries  # its own creation; no actor shows as "System"
    assert all("Someone else's" not in a["summary"] for a in feed)
    assert len(feed) == 3  # nothing of the other partner's


# --- the VA team ----------------------------------------------------------------------


def test_managers_list_the_vas_and_what_each_holds(api, db, team):
    agency(db, team["sarah"])
    gone, _ = person(db, Role.virtual_assistant, "Zed Gone")
    gone.deactivated_at = utc_now_ms()
    db.flush()
    rows = {r["full_name"]: r for r in api.get(f"{URL}/va-users", headers=team["director"]).json()["data"]}
    assert (rows["Sarah VA"]["partners_assigned"], rows["Daniel VA"]["partners_assigned"]) == (2, 1)
    assert (rows["Sarah VA"]["is_active"], rows["Zed Gone"]["is_active"]) == (True, False)
    assert "password_hash" not in rows["Sarah VA"]
    assert api.get(f"{URL}/va-users", headers=team["as_sarah"]).status_code == 403


# --- the partner's onboarding fields --------------------------------------------------------


def test_signing_stamps_the_date_and_a_revert_clears_it(api, db, team):
    p, d = team["his"], team["director"]
    for field, stamp in (("mou_status", "mou_signed_at"), ("sla_status", "sla_signed_at")):
        signed = api.patch(f"{URL}/partners/{p.id}", headers=d, json={field: "signed"}).json()["data"]
        assert signed[stamp] is not None, field
        again = api.patch(f"{URL}/partners/{p.id}", headers=d, json={field: "signed"}).json()["data"]
        assert again[stamp] == signed[stamp]  # already signed: the date stays
        reverted = api.patch(f"{URL}/partners/{p.id}", headers=d, json={field: "sent"}).json()["data"]
        assert reverted[stamp] is None, field  # upstream's DEF-003


def test_documents_and_the_responsible_va(api, db, team):
    p, d = team["his"], team["director"]
    first = api.patch(f"{URL}/partners/{p.id}", headers=d, json={"documents_submitted": True}).json()["data"]["documents_submitted_at"]
    assert first is not None
    assert api.patch(f"{URL}/partners/{p.id}", headers=d, json={"documents_submitted": True}).json()["data"]["documents_submitted_at"] == first
    assert api.patch(f"{URL}/partners/{p.id}", headers=d, json={"documents_submitted": False}).json()["data"]["documents_submitted_at"] is None
    moved = api.patch(f"{URL}/partners/{p.id}", headers=d, json={"assigned_team_member_id": team["sarah"].id}).json()["data"]
    assert moved["assigned_team_member_id"] == team["sarah"].id
    gone, _ = person(db, Role.virtual_assistant)
    gone.deactivated_at = utc_now_ms()
    db.flush()
    refused = api.patch(f"{URL}/partners/{p.id}", headers=d, json={"assigned_team_member_id": gone.id})
    assert (refused.status_code, error(refused)["message"]) == (422, "Assigned team member must be an active user.")
    cleared = api.patch(f"{URL}/partners/{p.id}", headers=d, json={"assigned_team_member_id": None}).json()["data"]
    assert cleared["assigned_team_member_id"] is None
    # A VA doesn't edit the partner record; it works through reports and follow-ups.
    assert api.patch(f"{URL}/partners/{team['hers'].id}", headers=team["as_sarah"], json={"sla_status": "signed"}).status_code == 403
