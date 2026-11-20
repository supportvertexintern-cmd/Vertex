"""The guide's user stories proven at the API (section 10; upstream staging's
tests/security/guide-gaps.test.ts): a VA's dashboard, the master dashboard,
the alerts, and one partner's profile at a glance. The journeys through the
UI are vertex/e2e/stories.spec.ts. Each test's stories ride on its proves
marker (tools/traceability.py)."""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

import pytest

from app.core.clock import utc_now_ms
from app.models.candidate import Candidate
from app.models.enums import CommissionStatus, MouStatus, PartnerCommissionRuleType, PartnerStatus, SlaStatus
from app.models.partner_tracking import PartnerCommission
from app.services.partner_flags import FlagInput, partner_flags
from tests.test_partner_performance import ledger  # noqa: F401  (a fixture)
from tests.test_partner_tracking import agency, api, person, team  # noqa: F401  (fixtures and helpers)

URL = "/api/v1"


@pytest.mark.proves("FUNC-US12 Sarah's VA dashboard")
def test_a_vas_dashboard_covers_exactly_her_partners(api, db, team):
    agency(db, team["sarah"], name="Sarah's Second")
    agency(db, None, name="Nobody's Agency")
    data = api.get(f"{URL}/va/overview", headers=team["as_sarah"])
    assert data.status_code == 200
    summary = data.json()["data"]["summary"]
    assert summary["total_partners"] == 2
    assert "Daniel's Agency" not in data.text and "Nobody's Agency" not in data.text


@pytest.mark.proves("FUNC-US13 / FUNC-US29 team performance and the master dashboard")
def test_the_master_dashboard_adds_up(api, ledger):
    d = api.get(f"{URL}/partner-performance", headers=ledger["director"]).json()["data"]
    team = {t["team_member"]: t for t in d["teamPerformance"]}
    assert team["Perf VA"]["partners_assigned"] == 2 and team["Unassigned"]["partners_assigned"] >= 1
    # Each panel's total is the sum of the partner rows behind it.
    assert d["totals"]["commissions_outstanding"] == pytest.approx(sum(r["commissions_outstanding"] for r in d["ranked"]))
    assert d["totals"]["commissions_paid"] == pytest.approx(sum(r["commissions_paid"] for r in d["ranked"]))
    assert d["totals"]["commissions_outstanding"] == pytest.approx(sum(t["outstanding"] for t in d["teamPerformance"]))
    assert api.get(f"{URL}/partner-performance", headers=ledger["as_va"]).status_code == 403


def flags(**fields) -> FlagInput:
    base = dict(status=PartnerStatus.active, mou_status=MouStatus.signed, sla_status=SlaStatus.signed, documents_submitted_at=utc_now_ms(),
                created_at=utc_now_ms(), submissions=1, activity=[utc_now_ms()], report_statuses=["submitted"], open_follow_ups=0)
    return FlagInput(**(base | fields))


@pytest.mark.proves("FUNC-US26 alerts")
def test_each_situation_raises_its_alert():
    now = utc_now_ms()
    assert "MOU not signed" in partner_flags(flags(mou_status=MouStatus.sent), now).flags
    # Signed with no applications: one alert for the one situation, never both wordings.
    signed_idle = partner_flags(flags(submissions=0, activity=[]), now).flags
    assert [f for f in signed_idle if "applications" in f or "candidates" in f] == ["Signed but no applications yet"]
    assert "No candidates submitted" in partner_flags(flags(mou_status=MouStatus.sent, submissions=0, activity=[]), now).flags
    quiet = partner_flags(flags(created_at=now - timedelta(days=30), activity=[now - timedelta(days=15)]), now)
    assert quiet.no_recent_activity is True


@pytest.mark.proves("FUNC-US26 alerts")
def test_a_pending_commission_is_not_due_only_an_approved_one(api, db, team):
    p = team["hers"]  # nothing signed: flagged, so it's on the overview
    pending, approved = (Candidate(full_name=f"Due {n}", partner_id=p.id) for n in "ab")
    db.add_all([pending, approved])
    db.flush()
    for c, status in ((pending, CommissionStatus.pending), (approved, CommissionStatus.approved)):
        db.add(PartnerCommission(partner_id=p.id, candidate_id=c.id, rule_type=PartnerCommissionRuleType.registration,
                                 period="registration", amount=Decimal("10"), status=status))
    db.flush()
    flagged = {f["partner_id"]: f for f in api.get(f"{URL}/va/overview", headers=team["as_sarah"]).json()["data"]["flags"]}
    assert flagged[p.id]["commissions_due"] == 10.0  # the approved one only


@pytest.mark.proves("FUNC-US30 a partner's profile at a glance matches its statement")
def test_a_partners_profile_matches_its_statement(api, ledger):
    rich = ledger["rich"].id
    t = api.get(f"{URL}/partners/{rich}/tracking", headers=ledger["director"]).json()["data"]
    s = api.get(f"{URL}/partners/{rich}/commission-statement", headers=ledger["director"]).json()["data"]
    # 1 registration status, 2 MOU and SLA, 3 reports, 4 application progress
    assert {"status", "mou_status", "sla_status"} <= set(t["partner"])
    assert isinstance(t["reports"], list) and "submitted" in t["stats"]
    # 5 registered, 6 deployed, 7 earned, 8 outstanding, 9 payment history
    assert t["stats"]["registered"] == s["summary"]["registered_candidates"] == 3
    assert s["summary"]["deployed_candidates"] == 1
    assert s["summary"]["outstanding"] == pytest.approx(s["summary"]["pending"] + s["summary"]["approved"])
    assert isinstance(s["history"], list) and s["history"]
    # 10 the assigned VA and pending actions
    assert t["partner"]["assigned_team_member"]["full_name"] == "Perf VA"
    assert isinstance(t["follow_ups"], list)
