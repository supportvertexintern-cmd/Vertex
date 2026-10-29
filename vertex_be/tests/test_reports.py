"""Report writes (step 5.4) answer as Next.js's POST /api/reports and PATCH
/api/reports/[id]/{verify,return,resubmit} did: the same roles, reporting
line, period rules, consolidation, messages, status codes and JSON."""

import re
import secrets
from datetime import date, timedelta

import pytest
from sqlalchemy import select, text

from app.api.v1.reports import RESUBMITTERS, REVIEWERS, SUBMITTERS, can_review
from app.core.config import BASE_DIR
from app.db.session import get_db
from app.main import app
from app.models.audit import AuditLog
from app.models.enums import ReportStatus, Role, ScopeLevel
from app.models.identity import Country, InhouseCountryAssignment, Region, User
from app.models.reporting import Report
from tests.test_auth import add_session, bearer, session_token
from tests.test_db_roles import roles_provisioned  # noqa: F401  (vertex_api must exist)

NEXT_REPORTS = BASE_DIR.parent / "vertex" / "src" / "app" / "api" / "reports"
URL = "/api/v1/reports"

# The last full Monday-to-Sunday week before today.
_today = date.today()
MONDAY = _today - timedelta(days=_today.weekday() + 7)
WEEK = {"type": "weekly", "period_start": MONDAY.isoformat(), "period_end": (MONDAY + timedelta(days=6)).isoformat()}


@pytest.fixture
def api(db, client):
    app.dependency_overrides[get_db] = lambda: db
    yield client
    app.dependency_overrides.pop(get_db, None)


def person(db, role: Role, **fields) -> tuple[User, dict[str, str]]:
    u = User(full_name=f"{role.value} {secrets.token_hex(2)}", email=f"rep-{secrets.token_hex(4)}@test.invalid", role=role, **fields)
    db.add(u)
    db.flush()
    db.refresh(u)
    s = add_session(db, u.id)
    return u, bearer(session_token(u.id, s.family_id, u.token_version))


@pytest.fixture
def line(db):
    """A reporting line in one country, and a second country nobody here works in."""
    region = Region(name=f"Rep region {secrets.token_hex(3)}")
    db.add(region)
    db.flush()
    home = Country(name=f"Rep home {secrets.token_hex(3)}", region_id=region.id)
    away = Country(name=f"Rep away {secrets.token_hex(3)}", region_id=region.id)
    db.add_all([home, away])
    db.flush()
    inhouse, inh = person(db, Role.inhouse_supervisor)
    db.add(InhouseCountryAssignment(inhouse_supervisor_id=inhouse.id, country_id=home.id))
    supervisor, sup = person(db, Role.country_supervisor, assigned_country_id=home.id)
    recruiter, rec = person(db, Role.regional_recruiter, assigned_country_id=home.id, supervisor_id=supervisor.id)
    _, director = person(db, Role.director)
    db.flush()
    return {"home": home, "away": away, "inhouse": inhouse, "inh": inh, "supervisor": supervisor, "sup": sup, "recruiter": recruiter, "rec": rec, "director": director}


def content(**fields) -> dict:
    return {"certified": True, "executive_summary": "On track.", "kpis": [{"label": "Candidate identification", "target": 10, "actual": 8}]} | fields


def submit(api, headers, **fields):
    return api.post(URL, headers=headers, json=WEEK | {"content": content()} | fields)


def test_the_roles_match_next_js():
    def roles(path, pattern):
        src = (NEXT_REPORTS / path).read_text(encoding="utf-8")
        return set(re.findall(r'"(\w+)"', re.search(pattern, src, re.S).group(1)))

    assert roles("route.ts", r"export async function POST.*?requireRole\(user, \[(.*?)\]\)") == {r.value for r in SUBMITTERS}
    for path in ("[id]/verify/route.ts", "[id]/return/route.ts"):
        assert roles(path, r"const REVIEWER_ROLES = \[(.*?)\]") == {r.value for r in REVIEWERS}, path
    assert roles("[id]/resubmit/route.ts", r"const STAFF_ROLES = \[(.*?)\]") == {r.value for r in RESUBMITTERS}


@pytest.mark.parametrize(
    ("role", "scope", "ok"),
    [
        (Role.country_supervisor, ScopeLevel.recruiter, True),
        (Role.inhouse_supervisor, ScopeLevel.recruiter, False),
        (Role.inhouse_supervisor, ScopeLevel.country, True),
        (Role.director, ScopeLevel.country, False),  # deliberately not a fallback
        (Role.director, ScopeLevel.inhouse, True),
        (Role.inhouse_supervisor, ScopeLevel.inhouse, False),
        (Role.admin, ScopeLevel.recruiter, True),
        (Role.regional_recruiter, ScopeLevel.recruiter, False),
        (Role.candidate, ScopeLevel.country, False),
    ],
)
def test_one_controlling_position_per_scope(role, scope, ok):
    assert can_review(role, scope) is ok


# --- submitting ---------------------------------------------------------------


def test_a_recruiter_submits_a_weekly_report(api, db, line):
    res = submit(api, line["rec"])
    assert res.status_code == 201
    data = res.json()["data"]
    assert {k: data[k] for k in ("type", "scope_level", "status")} == {"type": "weekly", "scope_level": "recruiter", "status": "submitted"}
    report = db.get(Report, data["id"])
    assert (report.country_id, report.submitted_by) == (line["home"].id, line["recruiter"].id)
    assert report.content["crm_reference"] == report.id  # never user-entered
    assert report.content["pipeline"] == [] and "overall_status" not in report.content
    assert report.content["kpis"] == [{"label": "Candidate identification", "target": 10, "actual": 8}]


def test_the_crm_reference_sent_is_replaced(api, db, line):
    data = submit(api, line["rec"], content=content(crm_reference="typed by hand")).json()["data"]
    assert db.get(Report, data["id"]).content["crm_reference"] == data["id"]


@pytest.mark.parametrize(
    ("fields", "field", "message"),
    [
        ({"period_start": (MONDAY + timedelta(days=1)).isoformat(), "period_end": (MONDAY + timedelta(days=7)).isoformat()}, "period_start", "A weekly report must start on a Monday."),
        ({"period_end": (MONDAY + timedelta(days=5)).isoformat()}, "period_end", "A weekly report must cover exactly 7 days (Monday through Sunday)."),
        ({"period_end": MONDAY.isoformat()}, "period_end", "Period end must be after the period start."),
        (
            {"type": "monthly", "period_start": "2099-01-01", "period_end": "2099-01-31"},
            "period_end",
            "A report can't cover a period that hasn't happened yet.",
        ),
    ],
)
def test_period_rules(api, line, fields, field, message):
    res = submit(api, line["rec"], **fields)
    assert res.status_code == 422
    assert message in res.json()["error"]["details"][field]


def test_a_daily_report_covers_one_day(api, line):
    day = (MONDAY + timedelta(days=2)).isoformat()
    assert submit(api, line["rec"], type="daily", period_start=day, period_end=day).status_code == 201


@pytest.mark.parametrize(
    "bad",
    [
        {"certified": False},
        {"overall_status": "purple"},
        {"kpis": [{"label": ""}]},
        {"executive_summary": None},  # zod's .optional() refuses null
        {"competencies": [{"area": "Teamwork", "self_rating": 6}]},
    ],
)
def test_content_rules(api, line, bad):
    assert submit(api, line["rec"], content=content(**bad)).status_code == 422


def test_unknown_content_keys_are_dropped(api, db, line):
    data = submit(api, line["rec"], content=content(extra="ignored", kpis=[{"label": "X", "junk": 1}])).json()["data"]
    stored = db.get(Report, data["id"]).content
    assert "extra" not in stored and stored["kpis"] == [{"label": "X"}]


def test_an_unassigned_submitter(api, db):
    _, rec = person(db, Role.regional_recruiter)
    _, inh = person(db, Role.inhouse_supervisor)
    for headers in (rec, inh):
        res = submit(api, headers)
        assert (res.status_code, res.json()["error"]["code"]) == (422, "no_country")


@pytest.mark.parametrize("role", list(Role))
def test_who_submits(api, db, line, role):
    someone, headers = person(db, role, assigned_country_id=line["home"].id)
    if role is Role.inhouse_supervisor:
        db.add(InhouseCountryAssignment(inhouse_supervisor_id=someone.id, country_id=line["home"].id))
        db.flush()
    assert (submit(api, headers).status_code == 201) is (role in SUBMITTERS)


# --- consolidation -------------------------------------------------------------


def verified_recruiter_report(api, line) -> str:
    rid = submit(api, line["rec"]).json()["data"]["id"]
    assert api.patch(f"{URL}/{rid}/verify", headers=line["sup"]).json()["data"]["status"] == "verified"
    return rid


def test_the_line_consolidates_up_to_the_director(api, db, line):
    recruiter_report = verified_recruiter_report(api, line)
    country = submit(api, line["sup"], child_report_ids=[recruiter_report]).json()["data"]
    assert country["scope_level"] == "country"
    child = db.get(Report, recruiter_report)
    assert (child.status, child.parent_report_id) == (ReportStatus.consolidated, country["id"])

    assert api.patch(f"{URL}/{country['id']}/verify", headers=line["inh"]).json()["data"]["status"] == "verified"
    portfolio = submit(api, line["inh"], child_report_ids=[country["id"]]).json()["data"]
    assert portfolio["scope_level"] == "inhouse" and db.get(Report, portfolio["id"]).country_id is None
    approved = api.patch(f"{URL}/{portfolio['id']}/verify", headers=line["director"])
    assert approved.json()["data"] == {"id": portfolio["id"], "status": "approved"}


def test_only_verified_children_from_your_own_country(api, db, line):
    submitted_only = submit(api, line["rec"]).json()["data"]["id"]
    res = submit(api, line["sup"], child_report_ids=[submitted_only])
    assert (res.status_code, res.json()["error"]) == (422, {"code": "invalid_children", "message": "Every consolidated report must be a verified report from your own country."})

    elsewhere = Report(
        type="weekly", scope_level=ScopeLevel.recruiter, country_id=line["away"].id, submitted_by=line["recruiter"].id,
        period_start=MONDAY, period_end=MONDAY + timedelta(days=6), status=ReportStatus.verified, content={},
    )
    db.add(elsewhere)
    db.flush()
    assert submit(api, line["sup"], child_report_ids=[elsewhere.id]).json()["error"]["code"] == "invalid_children"
    inh = submit(api, line["inh"], child_report_ids=[elsewhere.id]).json()["error"]
    assert inh["message"] == "Every consolidated report must be a verified report from one of your assigned countries."


def test_a_recruiter_report_consolidates_nothing(api, line):
    res = submit(api, line["rec"], child_report_ids=["cnosuchreport0"])
    assert (res.status_code, res.json()["error"]["code"]) == (422, "invalid_scope")


# --- reviewing -----------------------------------------------------------------


def test_returning_and_resubmitting(api, db, line):
    rid = submit(api, line["rec"]).json()["data"]["id"]
    short = api.patch(f"{URL}/{rid}/return", headers=line["sup"], json={"return_reason": "No"})
    assert short.status_code == 422
    returned = api.patch(f"{URL}/{rid}/return", headers=line["sup"], json={"return_reason": "Missing pipeline figures."})
    assert returned.json()["data"] == {"id": rid, "status": "returned", "return_reason": "Missing pipeline figures."}
    assert api.patch(f"{URL}/{rid}/verify", headers=line["sup"]).json()["error"]["message"] == "A report in 'returned' status cannot be verified."

    _, other = person(db, Role.regional_recruiter, assigned_country_id=line["home"].id)
    assert api.patch(f"{URL}/{rid}/resubmit", headers=other, json={"content": content()}).json()["error"]["message"] == "Only the original submitter can resubmit this report."
    assert api.patch(f"{URL}/{rid}/resubmit", headers=line["rec"], json={"content": content(certified=False)}).status_code == 422

    again = api.patch(f"{URL}/{rid}/resubmit", headers=line["rec"], json={"content": content(executive_summary="Fixed.", crm_reference="x")})
    assert again.json()["data"] == {"id": rid, "status": "submitted"}
    report = db.get(Report, rid)
    assert (report.return_reason, report.content["executive_summary"], report.content["crm_reference"]) == (None, "Fixed.", rid)
    assert api.patch(f"{URL}/{rid}/resubmit", headers=line["rec"], json={"content": content()}).json()["error"]["message"] == "Only a returned report can be resubmitted."


@pytest.mark.parametrize(
    ("reviewer", "message"),
    [
        ("inh", "You are not the controlling position for this report."),  # recruiter scope belongs to the Country Supervisor
        ("director", "You are not the controlling position for this report."),
        ("other_sup", "This report is not in your assigned country."),
    ],
)
def test_reviewing_a_recruiter_report(api, db, line, reviewer, message):
    _, other_sup = person(db, Role.country_supervisor, assigned_country_id=line["away"].id)
    headers = {"inh": line["inh"], "director": line["director"], "other_sup": other_sup}[reviewer]
    rid = submit(api, line["rec"]).json()["data"]["id"]
    for action, body in (("verify", None), ("return", {"return_reason": "Please fix it."})):
        res = api.patch(f"{URL}/{rid}/{action}", headers=headers, json=body)
        assert (res.status_code, res.json()["error"]["message"]) == (403, message)


def test_an_inhouse_supervisor_reviews_only_their_countries(api, db, line):
    other_inhouse, other_headers = person(db, Role.inhouse_supervisor)
    db.add(InhouseCountryAssignment(inhouse_supervisor_id=other_inhouse.id, country_id=line["away"].id))
    db.flush()
    rid = submit(api, line["sup"]).json()["data"]["id"]
    res = api.patch(f"{URL}/{rid}/verify", headers=other_headers)
    assert (res.status_code, res.json()["error"]["message"]) == (403, "This report is not in one of your assigned countries.")


def test_a_missing_report(api, line):
    for res in (
        api.patch(f"{URL}/cnosuchreport0/verify", headers=line["sup"]),
        api.patch(f"{URL}/cnosuchreport0/return", headers=line["sup"], json={"return_reason": "Please fix it."}),
        api.patch(f"{URL}/cnosuchreport0/resubmit", headers=line["rec"], json={"content": content()}),
    ):
        assert (res.status_code, res.json()["error"]["message"]) == (404, "Report not found.")


def test_admin_overrides_the_line(api, db, line):
    _, admin = person(db, Role.admin)
    rid = submit(api, line["rec"]).json()["data"]["id"]
    api.patch(f"{URL}/{rid}/return", headers=admin, json={"return_reason": "Please fix it."})
    assert api.patch(f"{URL}/{rid}/resubmit", headers=admin, json={"content": content()}).json()["data"]["status"] == "submitted"
    assert api.patch(f"{URL}/{rid}/verify", headers=admin).json()["data"]["status"] == "verified"


# --- audit ---------------------------------------------------------------------


def test_the_whole_line_is_on_the_trail_as_vertex_api(api, db, line):
    db.execute(text("SET LOCAL ROLE vertex_api"))
    try:
        rid = verified_recruiter_report(api, line)
        country = submit(api, line["sup"], child_report_ids=[rid])
    finally:
        db.execute(text("RESET ROLE"))
    assert country.status_code == 201

    def trail(entity_id):
        return [(e.action, e.actor_id) for e in db.scalars(select(AuditLog).where(AuditLog.entity_id == entity_id).order_by(AuditLog.created_at, AuditLog.id))]

    sup = line["supervisor"].id
    assert trail(rid) == [("create", line["recruiter"].id), ("update", sup), ("update", sup)]  # submitted, verified, consolidated
    created = db.scalars(select(AuditLog).where(AuditLog.entity_id == country.json()["data"]["id"])).one()
    assert created.after["content"]["crm_reference"] == country.json()["data"]["id"]
