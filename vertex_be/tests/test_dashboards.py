"""Reads handover R3: the recruitment-operations dashboards and report reads
(app/api/v1/dashboards.py, app/services/kpi.py, report_reads.py). Each
answers as the website's Prisma read did: the same roles and scopes, the
same numbers, the same JSON keys, dates as Prisma writes them."""

import re
import secrets
from datetime import datetime, timedelta

import pytest

from app.core.clock import utc_now_ms
from app.db.session import get_db
from app.main import app
from app.models.campaign import Campaign, CampaignTarget, RecruiterTarget
from app.models.candidate import Candidate
from app.models.enums import CampaignMetric, CampaignStatus, CandidateLifecycleStatus as L, ReportCycle, ReportStatus, Role, ScopeLevel
from app.models.identity import Country, InhouseCountryAssignment, Region, User
from app.models.reporting import Report, StaffKpiTarget
from app.services import kpi
from tests.test_auth import add_session, bearer, session_token

ISO_Z = re.compile(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z")
WEEK = (datetime(2026, 10, 19), datetime(2026, 10, 25))  # a Monday to Sunday


@pytest.fixture
def api(db, client):
    app.dependency_overrides[get_db] = lambda: db
    yield client
    app.dependency_overrides.pop(get_db, None)


def tag() -> str:
    return secrets.token_hex(3)


def add_user(db, role: Role, **fields) -> User:
    u = User(full_name=f"{role.value} {tag()}", email=f"dash-{tag()}@test.invalid", role=role, **fields)
    db.add(u)
    db.flush()
    db.refresh(u)
    return u


def h(db, user: User) -> dict[str, str]:
    s = add_session(db, user.id)
    return bearer(session_token(user.id, s.family_id, user.token_version))


def report(db, by: User, scope: ScopeLevel, status: ReportStatus, country: Country | None, content=None, cycle=ReportCycle.weekly, period=WEEK) -> Report:
    r = Report(type=cycle, scope_level=scope, status=status, submitted_by=by.id, country_id=country.id if country else None,
               period_start=period[0], period_end=period[1], content=content or {})
    db.add(r)
    db.flush()
    return r


@pytest.fixture
def world(db):
    region = Region(name=f"Dashregion {tag()}")
    db.add(region)
    db.flush()
    home, away = Country(name=f"Dashhome {tag()}", region_id=region.id), Country(name=f"Dashaway {tag()}", region_id=region.id)
    db.add_all([home, away])
    db.flush()
    director = add_user(db, Role.director)
    inhouse = add_user(db, Role.inhouse_supervisor)
    db.add(InhouseCountryAssignment(inhouse_supervisor_id=inhouse.id, country_id=home.id))
    supervisor = add_user(db, Role.country_supervisor, assigned_country_id=home.id)
    other_supervisor = add_user(db, Role.country_supervisor, assigned_country_id=away.id)
    recruiter = add_user(db, Role.regional_recruiter, supervisor_id=supervisor.id, assigned_country_id=home.id)
    stranger = add_user(db, Role.regional_recruiter, supervisor_id=other_supervisor.id, assigned_country_id=away.id)
    # The funnel in home: 4 candidates, 2 verified or later, 1 approved.
    for status in (L.identified, L.screened, L.verified, L.approved):
        db.add(Candidate(full_name=f"Dash {status.value}", country_id=home.id, recruiter_id=recruiter.id, lifecycle_status=status))
    db.add(Candidate(full_name="Dash away", country_id=away.id, recruiter_id=stranger.id, lifecycle_status=L.approved))
    campaign = Campaign(name=f"Dash campaign {tag()}", criteria={}, status=CampaignStatus.active, created_by=director.id,
                        start_date=datetime(2026, 1, 1), end_date=datetime(2027, 1, 1))
    db.add(campaign)
    db.flush()
    target = CampaignTarget(campaign_id=campaign.id, metric=CampaignMetric.verified_candidates, country_id=home.id, target_value=10)
    db.add(target)
    db.flush()
    db.add(RecruiterTarget(campaign_target_id=target.id, recruiter_id=recruiter.id, target_value=5, set_by=supervisor.id))
    db.flush()
    return {"home": home, "away": away, "director": director, "inhouse": inhouse, "supervisor": supervisor, "other_supervisor": other_supervisor,
            "recruiter": recruiter, "stranger": stranger, "campaign": campaign, "target": target}


def data(res):
    assert res.status_code == 200, res.text
    return res.json()["data"]


ALL_TIME = {"period_start": "2000-01-01", "period_end": "2100-01-01"}


# --- the KPI arithmetic --------------------------------------------------------------


def test_the_percentages_round_half_up_as_javascript_did():
    assert kpi.percent(1, 8) == 12.5 and kpi.percent(1, 3) == 33.3 and kpi.percent(2, 3) == 66.7 and kpi.percent(0, 0) == 0
    assert kpi.percent(1, 16) == 6.3  # 62.5 rounds up, not to even


def test_the_funnel_and_conversion(db, world):
    f = kpi.KpiFilters(datetime(2000, 1, 1), datetime(2100, 1, 1), country_ids=(world["home"].id,))
    flow = kpi.applicant_flow(db, f)
    assert (flow["identified"], flow["screened"], flow["verified"], flow["approved"], flow["submitted"]) == (1, 1, 1, 1, 0)
    assert kpi.verified_from_flow(flow) == 2
    assert kpi.conversion_rates(db, f)["overall"] == 50
    assert kpi.recruiter_response_rate(db, f) == 75
    assert [s["from"] for s in kpi.conversion_rates(db, f)["byStage"]][:2] == ["identified", "screened"]


# --- roles --------------------------------------------------------------------------


def urls(world) -> dict[str, set[Role]]:
    sup, mgmt, inh = {Role.country_supervisor, Role.admin}, {Role.director, Role.admin}, {Role.inhouse_supervisor, Role.admin}
    staff = {Role.regional_recruiter, Role.country_supervisor, Role.inhouse_supervisor, Role.director, Role.admin}
    return {
        "/api/v1/kpi": {Role.inhouse_supervisor, Role.director, Role.admin},
        "/api/v1/management/report-metrics": mgmt,
        "/api/v1/supervisor/recruiters": sup,
        "/api/v1/supervisor/team-targets": sup,
        "/api/v1/inhouse/campaigns": inh,
        "/api/v1/inhouse/supervisors": inh,
        "/api/v1/reports": staff,
        "/api/v1/referral-agents/x/targets": mgmt,
    }


@pytest.mark.parametrize("role", list(Role))
def test_who_may_read(api, db, world, role):
    headers = h(db, add_user(db, role))
    for url, allowed in urls(world).items():
        assert (api.get(url, headers=headers).status_code == 403) == (role not in allowed), (url, role)
    progress = api.get("/api/v1/recruiter-targets/progress", headers=headers, params=ALL_TIME).status_code
    assert (progress == 403) == (role is not Role.regional_recruiter)


# --- management ---------------------------------------------------------------------


def test_the_kpi_dashboard(api, db, world):
    d = data(api.get("/api/v1/kpi", headers=h(db, world["director"]), params=ALL_TIME | {"country_id": world["home"].id, "campaign_id": world["campaign"].id}))
    assert set(d) == {"summary", "targetsVsActuals", "partnerPerformance", "caseStageBreakdown"}
    assert d["summary"]["agentSignups"] == 4 and d["summary"]["conversion"]["overall"] == 50
    assert d["targetsVsActuals"] == [{"campaignTargetId": world["target"].id, "metric": "verified_candidates", "countryId": world["home"].id,
                                      "regionId": None, "targetValue": 10, "actualValue": 2}]
    assert data(api.get("/api/v1/kpi", headers=h(db, world["director"]), params=ALL_TIME))["targetsVsActuals"] is None


def test_an_inhouse_supervisor_is_held_to_their_countries(api, db, world):
    asked_away = data(api.get("/api/v1/kpi", headers=h(db, world["inhouse"]), params=ALL_TIME | {"country_id": world["away"].id}))
    assert asked_away["summary"]["agentSignups"] == 4  # home's, not away's
    nobody = data(api.get("/api/v1/kpi", headers=h(db, add_user(db, Role.inhouse_supervisor)), params=ALL_TIME))
    assert nobody["summary"]["agentSignups"] == 0


def test_report_metrics(api, db, world):
    report(db, world["recruiter"], ScopeLevel.recruiter, ReportStatus.verified, world["home"])
    report(db, world["recruiter"], ScopeLevel.recruiter, ReportStatus.returned, world["home"], period=(datetime(2026, 10, 26), datetime(2026, 11, 1)))
    res = api.get("/api/v1/management/report-metrics", headers=h(db, world["director"]), params={"country_id": world["home"].id, "q": world["recruiter"].full_name.upper()})
    body = res.json()
    assert set(body) == {"data", "total", "page", "pageSize"} and (body["total"], body["pageSize"]) == (1, 15)
    row = body["data"][0]
    assert (row["submittedCount"], row["verifiedCount"], row["returnedCount"]) == (2, 1, 1)
    assert row["lastReportAt"] == "2026-11-01T00:00:00.000Z" and row["country"] == {"id": world["home"].id, "name": world["home"].name}
    assert api.get("/api/v1/management/report-metrics", headers=h(db, world["director"]), params={"cadence": "yearly"}).status_code == 422


# --- supervisors ---------------------------------------------------------------------


def test_the_country_overview(api, db, world):
    report(db, world["recruiter"], ScopeLevel.recruiter, ReportStatus.submitted, world["home"])
    d = data(api.get("/api/v1/supervisor/overview", headers=h(db, world["supervisor"]), params=ALL_TIME))
    assert {k: d[k] for k in ("countryName", "recruiterCount", "candidateCount", "pendingVerificationCount", "reportsAwaitingReviewCount")} == {
        "countryName": world["home"].name, "recruiterCount": 1, "candidateCount": 4, "pendingVerificationCount": 0, "reportsAwaitingReviewCount": 1}
    assert d["targetProgress"][0]["actualValue"] == 2
    res = api.get("/api/v1/supervisor/overview", headers=h(db, world["supervisor"]))
    assert (res.status_code, res.json()["error"]["message"]) == (422, "period_start and period_end are required.")
    assert api.get("/api/v1/supervisor/overview", headers=h(db, world["supervisor"]), params={"period_start": "nope", "period_end": "2026-01-01"}).status_code == 422


def test_a_supervisors_recruiters(api, db, world):
    rows = data(api.get("/api/v1/supervisor/recruiters", headers=h(db, world["supervisor"])))
    assert [r["id"] for r in rows] == [world["recruiter"].id]
    assert (rows[0]["candidatesTotal"], rows[0]["conversionRate"], rows[0]["lastReportAt"]) == (4, 50, None)
    detail = data(api.get(f"/api/v1/supervisor/recruiters/{world['recruiter'].id}", headers=h(db, world["supervisor"]), params=ALL_TIME))
    assert set(detail) == {"recruiter", "candidatesTotal", "conversionRate", "targetProgress", "campaignTargets", "allocations"}
    assert detail["targetProgress"][0]["targetValue"] == 5 and detail["allocations"][0]["target_value"] == 5
    assert ISO_Z.fullmatch(detail["campaignTargets"][0]["campaign"]["start_date"])


def test_another_supervisors_recruiter_is_refused(api, db, world):
    res = api.get(f"/api/v1/supervisor/recruiters/{world['stranger'].id}", headers=h(db, world["supervisor"]))
    assert (res.status_code, res.json()["error"]["message"]) == (403, "This recruiter is not under your supervision.")
    assert api.get(f"/api/v1/supervisor/recruiters/{world['supervisor'].id}", headers=h(db, world["supervisor"])).status_code == 404


def test_team_targets(api, db, world):
    d = data(api.get("/api/v1/supervisor/team-targets", headers=h(db, world["supervisor"])))
    assert [t["id"] for t in d["campaignTargets"]] == [world["target"].id]
    assert d["recruiters"] == [{"id": world["recruiter"].id, "full_name": world["recruiter"].full_name}]
    assert len(d["allocations"]) == 1
    assert data(api.get("/api/v1/supervisor/team-targets", headers=h(db, add_user(db, Role.country_supervisor)))) == {
        "campaignTargets": [], "recruiters": [], "allocations": []}


def test_the_inhouse_overview(api, db, world):
    today = utc_now_ms().replace(hour=12, minute=0, second=0, microsecond=0)
    report(db, world["recruiter"], ScopeLevel.recruiter, ReportStatus.submitted, world["home"], cycle=ReportCycle.daily, period=(today, today))
    d = data(api.get("/api/v1/inhouse/overview", headers=h(db, world["inhouse"])))
    assert d["dailyCompliance"] == {"submitted": 1, "total": 1, "recruiters": [{"id": world["recruiter"].id, "full_name": world["recruiter"].full_name, "submittedToday": True}]}
    assert d["candidateFunnel"]["approved"] == 1 and d["campaignTargets"][0]["actualValue"] == 2
    assert d["countrySupervisors"][0]["assigned_country"] == {"id": world["home"].id, "name": world["home"].name}
    res = api.get("/api/v1/inhouse/overview", headers=h(db, add_user(db, Role.inhouse_supervisor)))
    assert (res.status_code, res.json()["error"]["code"]) == (422, "no_country")


def test_inhouse_campaigns_and_supervisors(api, db, world):
    camp = data(api.get("/api/v1/inhouse/campaigns", headers=h(db, world["inhouse"])))
    mine = next(c for c in camp["campaigns"] if c["id"] == world["campaign"].id)
    assert camp["countryIds"] == [world["home"].id] and [t["id"] for t in mine["targets"]] == [world["target"].id]
    sups = data(api.get("/api/v1/inhouse/supervisors", headers=h(db, world["inhouse"])))
    assert [s["id"] for s in sups] == [world["supervisor"].id] and sups[0]["candidatesTotal"] == 4
    assert api.get(f"/api/v1/inhouse/supervisors/{world['other_supervisor'].id}", headers=h(db, world["inhouse"])).status_code == 403
    assert data(api.get(f"/api/v1/inhouse/supervisors/{world['supervisor'].id}", headers=h(db, world["inhouse"])))["conversionRate"] == 50


# --- reports --------------------------------------------------------------------------


@pytest.fixture
def reports(db, world):
    mine = report(db, world["recruiter"], ScopeLevel.recruiter, ReportStatus.verified, world["home"],
                  {"executive_summary": "Good week.", "kpis": [{"label": "Calls", "target": 10, "actual": 8}], "issues": [{"label": "Visa", "detail": "Delays"}]})
    theirs = report(db, world["stranger"], ScopeLevel.recruiter, ReportStatus.verified, world["away"])
    country = report(db, world["supervisor"], ScopeLevel.country, ReportStatus.submitted, world["home"])
    portfolio = report(db, world["inhouse"], ScopeLevel.inhouse, ReportStatus.submitted, None)
    return {"mine": mine, "theirs": theirs, "country": country, "portfolio": portfolio}


def visible(api, db, user, **params) -> set[str]:
    body = api.get("/api/v1/reports", headers=h(db, user), params=params).json()
    assert set(body) == {"data", "total", "page", "pageSize"}
    return {r["id"] for r in body["data"]}


def test_who_sees_which_reports(api, db, world, reports):
    r = reports
    assert visible(api, db, world["recruiter"]) == {r["mine"].id}
    assert visible(api, db, world["supervisor"]) == {r["mine"].id, r["country"].id}
    assert visible(api, db, world["inhouse"]) == {r["mine"].id, r["country"].id, r["portfolio"].id}
    assert r["portfolio"].id in visible(api, db, world["director"]) and r["mine"].id not in visible(api, db, world["director"])


def test_report_filters_and_detail(api, db, world, reports):
    admin = add_user(db, Role.admin)
    assert visible(api, db, admin, country_id=world["home"].id) >= {reports["mine"].id, reports["portfolio"].id}  # the portfolio by its submitter's country
    assert reports["theirs"].id not in visible(api, db, admin, country_id=world["home"].id)
    assert visible(api, db, admin, q=world["stranger"].full_name) == {reports["theirs"].id}
    row = data(api.get(f"/api/v1/reports/{reports['mine'].id}", headers=h(db, world["supervisor"])))
    assert set(row) == {"id", "type", "scope_level", "status", "period_start", "period_end", "return_reason", "content", "submitter",
                        "country", "parent_report_id", "child_reports", "created_at"}
    assert row["period_start"] == "2026-10-19T00:00:00.000Z"
    assert api.get(f"/api/v1/reports/{reports['theirs'].id}", headers=h(db, world["supervisor"])).status_code == 404


def test_the_consolidation_preview(api, db, world, reports):
    params = {"type": "weekly", "period_start": "2026-10-19", "period_end": "2026-10-25"}
    d = data(api.get("/api/v1/reports/consolidation-preview", headers=h(db, world["supervisor"]), params=params))
    assert d["roster"] == [{"id": world["recruiter"].id, "full_name": world["recruiter"].full_name, "reportId": reports["mine"].id, "status": "verified"}]
    assert d["verifiedReportIds"] == [reports["mine"].id] and d["alreadyConsolidated"] is True
    assert d["content"]["kpis"] == [{"label": "Calls", "target": 10, "actual": 8}]
    assert d["content"]["issues"] == [{"label": "Visa", "detail": f"[{world['recruiter'].full_name}] Delays"}]
    assert d["content"]["executive_summary"] == "Good week."
    port = data(api.get("/api/v1/reports/consolidation-preview", headers=h(db, world["inhouse"]), params=params))
    assert port["roster"][0]["supervisor"] == {"id": world["supervisor"].id, "full_name": world["supervisor"].full_name}
    assert (port["roster"][0]["status"], port["verifiedReportIds"], port["alreadyConsolidated"]) == ("submitted", [], True)
    assert api.get("/api/v1/reports/consolidation-preview", headers=h(db, world["supervisor"]), params=params | {"type": "daily"}).status_code == 422


# --- staff KPI targets ------------------------------------------------------------------


def test_staff_kpi_targets(api, db, world):
    db.add(StaffKpiTarget(staff_id=world["recruiter"].id, cycle=ReportCycle.weekly, kpi_label="Calls", target_value=12, set_by=world["supervisor"].id))
    report(db, world["recruiter"], ScopeLevel.recruiter, ReportStatus.submitted, world["home"], {"kpis": [{"label": "Calls", "actual": 9}]})
    report(db, world["recruiter"], ScopeLevel.recruiter, ReportStatus.draft, world["home"], {"kpis": [{"label": "Calls", "actual": 99}]},
           period=(datetime(2026, 10, 26), datetime(2026, 11, 1)))
    own = data(api.get("/api/v1/staff-kpi-targets", headers=h(db, world["recruiter"]), params={"cycle": "weekly"}))
    assert [(t["kpiLabel"], t["targetValue"], t["actualValue"]) for t in own] == [("Calls", 12, 9)]  # the draft doesn't count
    by_manager = api.get("/api/v1/staff-kpi-targets", headers=h(db, world["supervisor"]), params={"cycle": "weekly", "staff_id": world["recruiter"].id})
    assert data(by_manager) == own
    assert api.get("/api/v1/staff-kpi-targets", headers=h(db, world["other_supervisor"]), params={"cycle": "weekly", "staff_id": world["recruiter"].id}).status_code == 403
    assert api.get("/api/v1/staff-kpi-targets", headers=h(db, world["recruiter"])).status_code == 422


def test_a_recruiters_progress(api, db, world):
    rows = data(api.get("/api/v1/recruiter-targets/progress", headers=h(db, world["recruiter"]), params=ALL_TIME))
    assert [(r["metric"], r["targetValue"], r["actualValue"]) for r in rows] == [("verified_candidates", 5, 2)]
    empty = data(api.get("/api/v1/recruiter-targets/progress", headers=h(db, world["recruiter"]),
                         params={"period_start": "2000-01-01", "period_end": (datetime(2000, 1, 1) + timedelta(days=1)).isoformat()}))
    assert empty[0]["actualValue"] == 0


# --- what kpi.test.ts covered on the website ---------------------------------------------


def test_the_stage_by_stage_conversion(db, world):
    f = kpi.KpiFilters(datetime(2000, 1, 1), datetime(2100, 1, 1), country_ids=(world["home"].id,))
    rates = {(s["from"], s["to"]): s["rate"] for s in kpi.conversion_rates(db, f)["byStage"]}
    # identified 1, screened 1, verified 1, approved 1: 4 reached identified, 3 screened...
    assert rates[("identified", "screened")] == 75
    assert rates[("screened", "guided_to_apply")] == kpi.percent(2, 3)
    assert rates[("verified", "approved")] == 50


def test_partner_performance_counts_the_period_only(db, world):
    from app.models.partners import Partner

    partner = Partner(name=f"Dash partner {tag()}", partner_type="travel_agency", country_of_operation="Kenya",
                      contact_name="C", contact_email=f"d-{tag()}@test.invalid", contact_phone="+1")
    idle = Partner(name=f"Dash idle {tag()}", partner_type="travel_agency", country_of_operation="Kenya",
                   contact_name="C", contact_email=f"i-{tag()}@test.invalid", contact_phone="+1")
    db.add_all([partner, idle])
    db.flush()
    db.add_all([Candidate(full_name="P1", partner_id=partner.id, lifecycle_status=L.approved),
                Candidate(full_name="P2", partner_id=partner.id, lifecycle_status=L.screened)])
    db.flush()
    rows = {r["partnerId"]: r for r in kpi.partner_performance(db, kpi.KpiFilters(datetime(2000, 1, 1), datetime(2100, 1, 1)))}
    assert rows[partner.id] == {"partnerId": partner.id, "partnerName": partner.name, "candidatesSourced": 2, "approved": 1}
    assert idle.id not in rows
    assert partner.id not in {r["partnerId"] for r in kpi.partner_performance(db, kpi.KpiFilters(datetime(2000, 1, 1), datetime(2000, 1, 2)))}


def test_a_referral_agents_targets_against_referrals(api, db, world):
    from app.models.enums import ReferralAgentStatus
    from app.models.referral import ReferralAgent, ReferralAgentTarget

    agent = ReferralAgent(full_name="Dash Agent", email=f"ra-{tag()}@test.invalid", phone="+1", country="X",
                          status=ReferralAgentStatus.active, referral_code=f"DASH{tag()}")
    db.add(agent)
    db.flush()
    now = utc_now_ms()
    db.add_all([
        ReferralAgentTarget(referral_agent_id=agent.id, period_start=now - timedelta(days=7), period_end=now + timedelta(days=1), target_referrals=4, set_by=world["director"].id),
        ReferralAgentTarget(referral_agent_id=agent.id, period_start=datetime(2001, 1, 1), period_end=datetime(2001, 2, 1), target_referrals=2, set_by=world["director"].id),
        Candidate(full_name="Referred now", referral_agent_id=agent.id),
    ])
    db.flush()
    rows = data(api.get(f"/api/v1/referral-agents/{agent.id}/targets", headers=h(db, world["director"])))
    assert [(r["targetReferrals"], r["actualReferrals"]) for r in rows] == [(4, 1), (2, 0)]  # newest period first
    assert ISO_Z.fullmatch(rows[0]["periodStart"])
