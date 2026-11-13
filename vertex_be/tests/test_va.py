"""The virtual assistants' portal (Phase 6): who reads it, a VA seeing only
its own partners, the "needs attention" flags, the dashboard's figures, and
the demo cast the dev seed loads."""

from __future__ import annotations

import re
import secrets
from datetime import datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import func, select

from app.api.v1.va import VA_LIST_ROLES, VA_OVERVIEW_ROLES
from app.core.clock import utc_now_ms
from app.core.config import BASE_DIR
from app.db.session import get_db
from app.main import app
from app.models.candidate import Candidate
from app.models.enums import (
    CommissionStatus,
    MouStatus,
    PartnerCandidateStatus,
    PartnerCommissionRuleType,
    PartnerFollowUpStatus,
    PartnerReportStatus,
    PartnerStatus,
    PartnerType,
    Role,
    SlaStatus,
)
from app.models.identity import User
from app.models.partner_tracking import PartnerCommission, PartnerCommissionRule, PartnerFollowUp, PartnerReport
from app.models.partners import Partner, PartnerCandidate
from app.services.partner_flags import FlagInput, commission_due, partner_flags
from app.services.sessions import check_password
from scripts.seed import reference, test_accounts, va_demo
from tests.test_auth import add_session, bearer, session_token
from tests.test_db_roles import roles_provisioned  # noqa: F401  (vertex_api must exist)

NEXT_API = BASE_DIR.parent / "vertex" / "src" / "app" / "api" / "va"


@pytest.fixture
def api(db, client):
    app.dependency_overrides[get_db] = lambda: db
    yield client
    app.dependency_overrides.pop(get_db, None)


def person(db, role: Role) -> tuple[User, dict[str, str]]:
    u = User(full_name=f"VA test {secrets.token_hex(2)}", email=f"va-{secrets.token_hex(4)}@test.invalid", role=role)
    db.add(u)
    db.flush()
    db.refresh(u)
    return u, bearer(session_token(u.id, add_session(db, u.id).family_id, u.token_version))


def partner(db, keeper: User | None, **fields) -> Partner:
    p = Partner(
        name=fields.pop("name", f"Agency {secrets.token_hex(3)}"), partner_type=PartnerType.manpower_supplier, country_of_operation="Kenya",
        contact_name="Pat", contact_email=f"p-{secrets.token_hex(3)}@test.invalid", contact_phone="1", status=PartnerStatus.active,
        assigned_team_member_id=keeper.id if keeper else None, **fields,
    )
    db.add(p)
    db.flush()
    return p


def next_roles(route: str) -> set[str]:
    src = (NEXT_API / route / "route.ts").read_text(encoding="utf-8")
    return set(re.findall(r'"(\w+)"', re.search(r"requireRole\(user, \[(.*?)\]\)", src, re.S).group(1)))


def test_the_roles_match_next_js():
    assert next_roles("partners") == {r.value for r in VA_LIST_ROLES}
    assert next_roles("overview") == {r.value for r in VA_OVERVIEW_ROLES}


@pytest.mark.parametrize("role", list(Role))
def test_who_reads_the_portal(api, db, role):
    _, headers = person(db, role)
    assert api.get("/api/v1/va/partners", headers=headers).status_code == (200 if role in VA_LIST_ROLES else 403)
    assert api.get("/api/v1/va/overview", headers=headers).status_code == (200 if role in VA_OVERVIEW_ROLES else 403)


def test_a_va_sees_only_its_own_partners(api, db):
    sarah, as_sarah = person(db, Role.virtual_assistant)
    daniel, _ = person(db, Role.virtual_assistant)
    _, as_director = person(db, Role.director)
    mine, theirs, nobodys = partner(db, sarah, name="AAA Mine"), partner(db, daniel), partner(db, None)
    db.add(PartnerCandidate(partner_id=mine.id, status=PartnerCandidateStatus.submitted, full_name="Abel"))
    db.flush()
    [row] = api.get("/api/v1/va/partners", headers=as_sarah).json()["data"]
    assert row == {
        "id": mine.id, "name": "AAA Mine", "status": "active", "mou_status": "none", "sla_status": "none",
        "assigned_team_member": {"id": sarah.id, "full_name": sarah.full_name}, "submissions": 1,
    }
    assert [p["partner_id"] for p in api.get("/api/v1/va/overview", headers=as_sarah).json()["data"]["flags"]] == [mine.id]
    everyone = {p["id"] for p in api.get("/api/v1/va/partners", headers=as_director).json()["data"]}
    assert {mine.id, theirs.id, nobodys.id} <= everyone


NOW = datetime(2026, 11, 13, 12, 0)


def flags(**changes) -> list[str]:
    base = dict(
        status=PartnerStatus.active, mou_status=MouStatus.signed, sla_status=SlaStatus.signed, documents_submitted_at=NOW,
        created_at=NOW, submissions=1, activity=[NOW], report_statuses=["submitted"], open_follow_ups=0,
    )
    return partner_flags(FlagInput(**(base | changes)), NOW).flags


def test_the_flags():
    assert flags() == []
    assert flags(mou_status=MouStatus.sent, sla_status=SlaStatus.none) == ["MOU not signed", "SLA not signed"]
    # A suspended partner isn't trading: its agreements aren't flagged.
    assert flags(status=PartnerStatus.suspended, mou_status=MouStatus.none) == []
    assert flags(documents_submitted_at=None) == ["Onboarding documents pending"]
    assert flags(report_statuses=[]) == ["No report recorded"]
    assert flags(report_statuses=["submitted", "returned"]) == ["Report outstanding"]
    # One situation, one alert.
    assert flags(submissions=0) == ["Signed but no applications yet"]
    assert flags(submissions=0, mou_status=MouStatus.sent) == ["MOU not signed", "No candidates submitted"]
    assert flags(open_follow_ups=2) == ["Open follow-up"]
    old = NOW - timedelta(days=15)
    assert flags(activity=[old]) == ["No activity in 14 days"]
    # A new partner with nothing submitted yet isn't "inactive".
    assert "No activity in 14 days" not in flags(activity=[], created_at=NOW - timedelta(days=2), submissions=0)


def test_only_months_that_have_arrived_are_due():
    assert commission_due(PartnerCommissionRuleType.registration, "registration", NOW)
    assert commission_due(PartnerCommissionRuleType.monthly_deployment, "2026-11", NOW)
    assert not commission_due(PartnerCommissionRuleType.monthly_deployment, "2026-12", NOW)


def test_the_overview_figures(api, db):
    va, headers = person(db, Role.virtual_assistant)
    now = utc_now_ms()
    on_track = partner(db, va, mou_status=MouStatus.signed, sla_status=SlaStatus.signed, documents_submitted_at=now)
    behind = partner(db, va, mou_status=MouStatus.sent)
    candidate = Candidate(full_name="Meron")
    db.add_all([candidate, PartnerReport(partner_id=on_track.id, reported_at=now, content={"notes": "ok"}, status=PartnerReportStatus.submitted)])
    db.flush()
    db.add_all([
        PartnerCandidate(partner_id=on_track.id, status=PartnerCandidateStatus.job_assigned, full_name="Meron", bridged_candidate_id=candidate.id),
        PartnerFollowUp(partner_id=behind.id, action="Chase the MOU", status=PartnerFollowUpStatus.open),
        # Due: approved, registration. Not due: pending, or a month to come.
        PartnerCommission(partner_id=on_track.id, candidate_id=candidate.id, rule_type=PartnerCommissionRuleType.registration, period="registration",
                          amount=Decimal("10.00"), status=CommissionStatus.approved),
        PartnerCommission(partner_id=on_track.id, candidate_id=candidate.id, rule_type=PartnerCommissionRuleType.monthly_deployment,
                          period="2999-01", amount=Decimal("40.00"), status=CommissionStatus.approved),
        PartnerCommission(partner_id=on_track.id, candidate_id=candidate.id, rule_type=PartnerCommissionRuleType.monthly_deployment,
                          period="2000-01", amount=Decimal("40.00"), status=CommissionStatus.pending),
    ])
    db.flush()
    data = api.get("/api/v1/va/overview", headers=headers).json()["data"]
    assert data["summary"] == {
        "total_partners": 2, "agreements_signed": 1, "agreements_unsigned": 1, "reports_submitted": 1, "reports_outstanding": 1,
        "applications_started": 1, "applications_not_started": 1, "total_candidates": 1, "no_recent_activity": 0,
        "commissions_due": 10.0, "partners_flagged": 1,
    }
    [flagged] = data["flags"]
    assert (flagged["partner_id"], flagged["commissions_due"]) == (behind.id, 0.0)
    assert flagged["flags"] == ["MOU not signed", "SLA not signed", "Onboarding documents pending", "No report recorded", "No candidates submitted", "Open follow-up"]


def test_the_commission_rules_start_at_the_requirements_amounts(db):
    rules = {r.rule_type: r.amount for r in db.scalars(select(PartnerCommissionRule).where(PartnerCommissionRule.deleted_at.is_(None)))}
    assert rules == {PartnerCommissionRuleType.registration: Decimal("10.00"), PartnerCommissionRuleType.monthly_deployment: Decimal("40.00")}


def test_the_va_demo_cast_signs_in_and_a_rerun_adds_nothing(db):
    reference.seed(db)
    result = va_demo.seed(db)
    assert result == {"people": 3, "agencies": 5, "candidates created": 3}

    def totals():
        return tuple(db.scalar(select(func.count()).select_from(m)) for m in (User, Partner, PartnerCandidate, Candidate, PartnerReport, PartnerFollowUp))

    before = totals()
    assert va_demo.seed(db)["candidates created"] == 0
    assert totals() == before

    people = {u.email: u for u in db.scalars(select(User).where(User.email.like("%@va-demo.test")))}
    assert {e: u.role for e, u in people.items()} == {
        "michael@va-demo.test": Role.director, "sarah@va-demo.test": Role.virtual_assistant, "daniel@va-demo.test": Role.virtual_assistant,
    }
    assert all(check_password(test_accounts.PASSWORD, u.password_hash) for u in people.values())
    agencies = {p.name: p for p in db.scalars(select(Partner).where(Partner.contact_email.like("%@va-demo.test")))}
    keeper = {name: (people[f"{k}@va-demo.test"].id if k else None) for name, _, _, k, *_ in va_demo.AGENCIES}
    assert {name: p.assigned_team_member_id for name, p in agencies.items()} == keeper
    meron = db.scalar(select(PartnerCandidate).where(PartnerCandidate.full_name == "Meron Haile"))
    assert meron.status is PartnerCandidateStatus.job_assigned and meron.bridged_candidate_id is not None
