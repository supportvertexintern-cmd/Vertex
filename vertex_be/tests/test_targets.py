"""Recruiter targets, staff KPI targets and recruiter notes (step 5.2) answer
as Next.js's routes did: the same roles, management hierarchy, rules,
messages, status codes and JSON."""

import re
import secrets

import pytest
from sqlalchemy import select, text

from app.api.v1.targets import NOTE_READERS, NOTE_WRITERS, TARGET_READERS, TARGET_SETTERS
from app.core.config import BASE_DIR
from app.core.rbac import STAFF_ROLES
from app.core.report_templates import REPORT_KPI_LABELS
from app.db.session import get_db
from app.main import app
from app.models.audit import AuditLog
from app.models.campaign import Campaign, CampaignTarget
from app.models.enums import CampaignMetric, ReportCycle, Role
from app.models.identity import Country, InhouseCountryAssignment, Region, User
from tests.test_auth import add_session, bearer, session_token
from tests.test_db_roles import roles_provisioned  # noqa: F401  (vertex_api must exist)

NEXT_SRC = BASE_DIR.parent / "vertex" / "src"
ISO_Z = re.compile(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z")


@pytest.fixture
def api(db, client):
    app.dependency_overrides[get_db] = lambda: db
    yield client
    app.dependency_overrides.pop(get_db, None)


def person(db, role: Role, **fields) -> tuple[User, dict[str, str]]:
    u = User(full_name=f"{role.value} {secrets.token_hex(2)}", email=f"tgt-{secrets.token_hex(4)}@test.invalid", role=role, **fields)
    db.add(u)
    db.flush()
    db.refresh(u)
    s = add_session(db, u.id)
    return u, bearer(session_token(u.id, s.family_id, u.token_version))


@pytest.fixture
def world(db):
    """Two countries, a Country Supervisor with one recruiter in each of
    their own country and another, and campaign targets for both."""
    region = Region(name=f"Tgt region {secrets.token_hex(3)}")
    db.add(region)
    db.flush()
    home = Country(name=f"Tgt home {secrets.token_hex(3)}", region_id=region.id)
    away = Country(name=f"Tgt away {secrets.token_hex(3)}", region_id=region.id)
    db.add_all([home, away])
    db.flush()
    supervisor, sup_headers = person(db, Role.country_supervisor, assigned_country_id=home.id)
    recruiter, rec_headers = person(db, Role.regional_recruiter, supervisor_id=supervisor.id, assigned_country_id=home.id)
    stranger, _ = person(db, Role.regional_recruiter, assigned_country_id=home.id)
    campaign = Campaign(name="Tgt drive", criteria={}, created_by=supervisor.id, start_date="2026-11-01", end_date="2026-12-31")
    db.add(campaign)
    db.flush()
    home_target = CampaignTarget(campaign_id=campaign.id, metric=CampaignMetric.verified_candidates, country_id=home.id, target_value=100)
    away_target = CampaignTarget(campaign_id=campaign.id, metric=CampaignMetric.verified_candidates, country_id=away.id, target_value=100)
    db.add_all([home_target, away_target])
    db.flush()
    return {
        "home": home, "away": away, "campaign": campaign,
        "supervisor": supervisor, "sup": sup_headers,
        "recruiter": recruiter, "rec": rec_headers, "stranger": stranger,
        "home_target": home_target, "away_target": away_target,
    }


def ts_roles(path: str, pattern: str) -> set[str]:
    src = (NEXT_SRC / path).read_text(encoding="utf-8")
    return set(re.findall(r'"(\w+)"', re.search(pattern, src, re.S).group(1)))


def test_the_roles_match_next_js():
    assert ts_roles("app/api/recruiter-targets/route.ts", r"const STAFF_ROLES = \[(.*?)\]") == {r.value for r in TARGET_READERS}
    assert ts_roles("app/api/recruiter-targets/route.ts", r"const TARGET_SETTER_ROLES = \[(.*?)\]") == {r.value for r in TARGET_SETTERS}
    notes = (NEXT_SRC / "app/api/recruiter-notes/route.ts").read_text(encoding="utf-8")
    get_roles, post_roles = re.findall(r"requireRole\(user, \[(.*?)\]\)", notes)
    assert set(re.findall(r'"(\w+)"', get_roles)) == {r.value for r in NOTE_READERS}
    assert set(re.findall(r'"(\w+)"', post_roles)) == {r.value for r in NOTE_WRITERS}
    assert ts_roles("lib/rbac.ts", r"export const STAFF_ROLES: Role\[\] = \[(.*?)\]") == {r.value for r in STAFF_ROLES}


def test_the_kpi_labels_match_the_websites_report_templates():
    src = (NEXT_SRC / "lib" / "reportTemplates.ts").read_text(encoding="utf-8")
    body = src[src.index("export const REPORT_KPI_LABELS"):]
    body = re.sub(r"//[^\n]*", "", body[: body.index("\n};")])
    website = {}
    for role in re.finditer(r"\n  (\w+): \{(.*?)\n  \},", body, re.S):
        website[role.group(1)] = {c.group(1): re.findall(r'"([^"]*)"', c.group(2)) for c in re.finditer(r"(daily|weekly|monthly): \[(.*?)\]", role.group(2), re.S)}
    ours = {role.value: {cycle.value: list(labels) for cycle, labels in cycles.items()} for role, cycles in REPORT_KPI_LABELS.items()}
    assert website and ours == website


# --- recruiter targets -------------------------------------------------------


def test_a_supervisor_allocates_a_target_to_their_recruiter(api, db, world):
    body = {"campaign_target_id": world["home_target"].id, "recruiter_id": world["recruiter"].id, "target_value": 30}
    res = api.post("/api/v1/recruiter-targets", headers=world["sup"], json=body)
    assert res.status_code == 201
    data = res.json()["data"]
    assert set(data) == {"id", "campaign_target_id", "target_value", "updated_at", "recruiter"}
    assert data["recruiter"] == {"id": world["recruiter"].id, "full_name": world["recruiter"].full_name}

    again = api.post("/api/v1/recruiter-targets", headers=world["sup"], json=body | {"target_value": 45}).json()["data"]
    assert (again["id"], again["target_value"]) == (data["id"], 45)  # replaced, not duplicated


@pytest.mark.parametrize(
    ("who", "target", "message"),
    [
        ("stranger", "home_target", "You can only set targets for recruiters you supervise."),
        ("recruiter", "away_target", "This campaign target isn't scoped to your recruiter's country."),
    ],
)
def test_a_supervisor_stays_within_their_team_and_country(api, world, who, target, message):
    res = api.post("/api/v1/recruiter-targets", headers=world["sup"], json={"campaign_target_id": world[target].id, "recruiter_id": world[who].id, "target_value": 5})
    assert (res.status_code, res.json()["error"]) == (403, {"code": "forbidden", "message": message})


def test_admin_overrides_the_team_and_country(api, db, world):
    _, admin = person(db, Role.admin)
    res = api.post("/api/v1/recruiter-targets", headers=admin, json={"campaign_target_id": world["away_target"].id, "recruiter_id": world["stranger"].id, "target_value": 5})
    assert res.status_code == 201


def test_recruiter_target_not_found(api, world):
    missing_target = {"campaign_target_id": "cnosuchtarget0", "recruiter_id": world["recruiter"].id, "target_value": 5}
    assert api.post("/api/v1/recruiter-targets", headers=world["sup"], json=missing_target).json()["error"]["message"] == "Campaign target not found."
    not_a_recruiter = {"campaign_target_id": world["home_target"].id, "recruiter_id": world["supervisor"].id, "target_value": 5}
    assert api.post("/api/v1/recruiter-targets", headers=world["sup"], json=not_a_recruiter).json()["error"]["message"] == "Recruiter not found."


@pytest.mark.parametrize("body", [{"target_value": 0}, {"recruiter_id": "x"}, {"campaign_target_id": None}])
def test_recruiter_target_rules(api, world, body):
    base = {"campaign_target_id": world["home_target"].id, "recruiter_id": world["recruiter"].id, "target_value": 5}
    assert api.post("/api/v1/recruiter-targets", headers=world["sup"], json=base | body).status_code == 422


def test_each_role_sees_its_own_slice(api, db, world):
    _, admin = person(db, Role.admin)
    mine = api.post("/api/v1/recruiter-targets", headers=world["sup"], json={"campaign_target_id": world["home_target"].id, "recruiter_id": world["recruiter"].id, "target_value": 5}).json()["data"]
    other = api.post("/api/v1/recruiter-targets", headers=admin, json={"campaign_target_id": world["home_target"].id, "recruiter_id": world["stranger"].id, "target_value": 5}).json()["data"]

    def ids(headers, **params):
        return {t["id"] for t in api.get("/api/v1/recruiter-targets", headers=headers, params=params).json()["data"]}

    assert ids(world["rec"]) == {mine["id"]}
    assert mine["id"] in ids(world["sup"]) and other["id"] not in ids(world["sup"])
    assert {mine["id"], other["id"]} <= ids(admin, campaign_target_id=world["home_target"].id)
    listed = api.get("/api/v1/recruiter-targets", headers=world["rec"]).json()["data"][0]
    assert listed["campaign_target"]["campaign"]["name"] == "Tgt drive" and listed["campaign_target"]["country"]["id"] == world["home"].id


@pytest.mark.parametrize("role", list(Role))
def test_who_reads_and_sets_recruiter_targets(api, db, world, role):
    _, headers = person(db, role)
    assert api.get("/api/v1/recruiter-targets", headers=headers).status_code == (200 if role in TARGET_READERS else 403)
    body = {"campaign_target_id": world["home_target"].id, "recruiter_id": world["recruiter"].id, "target_value": 5}
    # A Country Supervisor who isn't this recruiter's is refused by the hierarchy, not the role.
    expected = {Role.admin: 201, Role.country_supervisor: 403}.get(role, 403)
    assert api.post("/api/v1/recruiter-targets", headers=headers, json=body).status_code == expected


# --- staff KPI targets -------------------------------------------------------


def kpi(staff: User, label: str | None = None, cycle: str = "weekly", value: float = 10) -> dict:
    labels = REPORT_KPI_LABELS[staff.role][ReportCycle(cycle)]
    return {"staff_id": staff.id, "cycle": cycle, "kpi_label": label or labels[0], "target_value": value}


def test_each_level_sets_targets_for_its_direct_reports(api, db, world):
    inhouse, inhouse_headers = person(db, Role.inhouse_supervisor)
    db.add(InhouseCountryAssignment(inhouse_supervisor_id=inhouse.id, country_id=world["home"].id))
    db.flush()
    _, director = person(db, Role.director)

    first = api.post("/api/v1/staff-kpi-targets", headers=world["sup"], json=kpi(world["recruiter"]))
    assert first.status_code == 201
    assert set(first.json()["data"]) == {"id", "staff_id", "cycle", "kpi_label", "target_value", "updated_at"}
    assert api.post("/api/v1/staff-kpi-targets", headers=inhouse_headers, json=kpi(world["supervisor"])).status_code == 201
    assert api.post("/api/v1/staff-kpi-targets", headers=director, json=kpi(inhouse, cycle="monthly")).status_code == 201

    again = api.post("/api/v1/staff-kpi-targets", headers=world["sup"], json=kpi(world["recruiter"], value=12)).json()["data"]
    assert (again["id"], again["target_value"]) == (first.json()["data"]["id"], 12)


@pytest.mark.parametrize(
    ("caller", "staff"),
    [
        ("sup", "stranger"),  # not their recruiter
        ("director", "recruiter"),  # skips two levels
        ("other_inhouse", "supervisor"),  # In-House Supervisor of another country
        ("rec", "recruiter"),  # nobody sets their own
    ],
)
def test_the_hierarchy_is_enforced(api, db, world, caller, staff):
    other_inhouse, other_headers = person(db, Role.inhouse_supervisor)
    db.add(InhouseCountryAssignment(inhouse_supervisor_id=other_inhouse.id, country_id=world["away"].id))
    db.flush()
    callers = {"sup": world["sup"], "rec": world["rec"], "director": person(db, Role.director)[1], "other_inhouse": other_headers}
    res = api.post("/api/v1/staff-kpi-targets", headers=callers[caller], json=kpi(world[staff]))
    assert (res.status_code, res.json()["error"]) == (403, {"code": "forbidden", "message": "You can only set targets for your own direct reports."})


def test_admin_sets_anyones_kpi_targets(api, db, world):
    _, admin = person(db, Role.admin)
    assert api.post("/api/v1/staff-kpi-targets", headers=admin, json=kpi(world["stranger"])).status_code == 201


def test_a_label_must_be_on_their_report_for_that_cycle(api, world):
    wrong_cycle = kpi(world["recruiter"], label=REPORT_KPI_LABELS[Role.regional_recruiter][ReportCycle.daily][0], cycle="weekly")
    for body in (kpi(world["recruiter"], label="Made-up KPI"), wrong_cycle):
        res = api.post("/api/v1/staff-kpi-targets", headers=world["sup"], json=body)
        assert (res.status_code, res.json()["error"]["code"]) == (422, "invalid_label")


def test_kpi_target_input(api, world):
    assert api.post("/api/v1/staff-kpi-targets", headers=world["sup"], json=kpi(world["recruiter"], value=0)).status_code == 422
    assert api.post("/api/v1/staff-kpi-targets", headers=world["sup"], json=kpi(world["recruiter"]) | {"cycle": "yearly"}).status_code == 422
    missing = api.post("/api/v1/staff-kpi-targets", headers=world["sup"], json=kpi(world["recruiter"]) | {"staff_id": "cnosuchstaff00"})
    assert (missing.status_code, missing.json()["error"]["message"]) == (404, "Staff member not found.")


# --- recruiter notes ---------------------------------------------------------


def test_a_supervisor_writes_and_the_recruiter_reads(api, world):
    res = api.post("/api/v1/recruiter-notes", headers=world["sup"], json={"recruiter_id": world["recruiter"].id, "message": "Great week!"})
    assert res.status_code == 201
    note = res.json()["data"]
    assert note["author"] == {"full_name": world["supervisor"].full_name} and ISO_Z.fullmatch(note["created_at"])
    assert api.get("/api/v1/recruiter-notes", headers=world["rec"]).json()["data"] == [note]
    assert api.get("/api/v1/recruiter-notes", headers=world["sup"], params={"recruiter_id": world["recruiter"].id}).json()["data"] == [note]


def test_notes_stay_within_the_team(api, world):
    for res in (
        api.post("/api/v1/recruiter-notes", headers=world["sup"], json={"recruiter_id": world["stranger"].id, "message": "Hi"}),
        api.get("/api/v1/recruiter-notes", headers=world["sup"], params={"recruiter_id": world["stranger"].id}),
    ):
        assert res.json()["error"] == {"code": "forbidden", "message": "This recruiter is not under your supervision."}
    own = api.get("/api/v1/recruiter-notes", headers=world["rec"], params={"recruiter_id": world["stranger"].id})
    assert own.json()["error"]["message"] == "You can only read your own notes."
    needs_id = api.get("/api/v1/recruiter-notes", headers=world["sup"])
    assert (needs_id.status_code, needs_id.json()["error"]["message"]) == (422, "recruiter_id is required.")


@pytest.mark.parametrize("message", ["", "x" * 2001])
def test_note_length(api, world, message):
    assert api.post("/api/v1/recruiter-notes", headers=world["sup"], json={"recruiter_id": world["recruiter"].id, "message": message}).status_code == 422


def test_admin_notes_a_missing_recruiter(api, db):
    _, admin = person(db, Role.admin)
    res = api.post("/api/v1/recruiter-notes", headers=admin, json={"recruiter_id": "cnosuchperson0", "message": "Hi"})
    assert (res.status_code, res.json()["error"]["message"]) == (404, "Recruiter not found.")


@pytest.mark.parametrize("role", list(Role))
def test_who_reads_and_writes_notes(api, db, role):
    _, headers = person(db, role)
    expected = 200 if role is Role.regional_recruiter else 422 if role in NOTE_READERS else 403
    assert api.get("/api/v1/recruiter-notes", headers=headers).status_code == expected


# --- audit -------------------------------------------------------------------


def test_every_write_is_on_the_trail_as_vertex_api(api, db, world):
    actor = world["supervisor"].id
    db.execute(text("SET LOCAL ROLE vertex_api"))
    try:
        t = api.post("/api/v1/recruiter-targets", headers=world["sup"], json={"campaign_target_id": world["home_target"].id, "recruiter_id": world["recruiter"].id, "target_value": 5})
        t2 = api.post("/api/v1/recruiter-targets", headers=world["sup"], json={"campaign_target_id": world["home_target"].id, "recruiter_id": world["recruiter"].id, "target_value": 7})
        k = api.post("/api/v1/staff-kpi-targets", headers=world["sup"], json=kpi(world["recruiter"]))
        n = api.post("/api/v1/recruiter-notes", headers=world["sup"], json={"recruiter_id": world["recruiter"].id, "message": "Logged"})
    finally:
        db.execute(text("RESET ROLE"))
    assert (t.status_code, t2.status_code, k.status_code, n.status_code) == (201, 201, 201, 201)

    def trail(entity_id):
        return [(e.action, e.actor_id) for e in db.scalars(select(AuditLog).where(AuditLog.entity_id == entity_id).order_by(AuditLog.created_at, AuditLog.id))]

    assert trail(t.json()["data"]["id"]) == [("create", actor), ("update", actor)]
    assert trail(k.json()["data"]["id"]) == [("create", actor)]
    assert trail(n.json()["data"]["id"]) == [("create", actor)]
