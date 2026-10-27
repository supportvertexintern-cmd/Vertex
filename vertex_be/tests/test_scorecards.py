"""Staff scorecards (step 5.3) answer as Next.js's /api/staff-scorecards
routes did: the same roles, rules, scoring, messages, status codes and
JSON."""

import re
import secrets

import pytest
from sqlalchemy import select, text

from app.api.v1.scorecards import (
    SCORECARD_AREAS,
    SCORECARD_READERS,
    SCORECARD_REVIEWERS,
    categorize,
    overall_score,
)
from app.core.config import BASE_DIR
from app.db.session import get_db
from app.main import app
from app.models.audit import AuditLog
from app.models.enums import Role
from app.models.identity import User
from app.models.reporting import StaffScorecard, StaffScorecardArea
from tests.test_auth import add_session, bearer, session_token
from tests.test_db_roles import roles_provisioned  # noqa: F401  (vertex_api must exist)

NEXT_SRC = BASE_DIR.parent / "vertex" / "src"
ISO_Z = re.compile(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z")
URL = "/api/v1/staff-scorecards"


@pytest.fixture
def api(db, client):
    app.dependency_overrides[get_db] = lambda: db
    yield client
    app.dependency_overrides.pop(get_db, None)


def person(db, role: Role, **fields) -> tuple[User, dict[str, str]]:
    u = User(full_name=f"{role.value} {secrets.token_hex(2)}", email=f"sc-{secrets.token_hex(4)}@test.invalid", role=role, **fields)
    db.add(u)
    db.flush()
    db.refresh(u)
    s = add_session(db, u.id)
    return u, bearer(session_token(u.id, s.family_id, u.token_version))


@pytest.fixture
def team(db):
    supervisor, sup = person(db, Role.country_supervisor)
    recruiter, rec = person(db, Role.regional_recruiter, supervisor_id=supervisor.id)
    return {"supervisor": supervisor, "sup": sup, "recruiter": recruiter, "rec": rec}


def all_rated(rating: int = 4) -> list[dict]:
    return [{"area_key": key, "rating": rating, "evidence": f"{key} notes"} for key, _ in SCORECARD_AREAS]


def draft(api, team, areas=None, month="2026-10-01"):
    return api.post(URL, headers=team["sup"], json={"staff_id": team["recruiter"].id, "period_month": month, "areas": areas if areas is not None else all_rated()})


# --- the copies match the website --------------------------------------------


def test_the_roles_match_next_js():
    lst = (NEXT_SRC / "app/api/staff-scorecards/route.ts").read_text(encoding="utf-8")
    get_roles = re.search(r"export async function GET.*?requireRole\(user, \[(.*?)\]\)", lst, re.S).group(1)
    assert set(re.findall(r'"(\w+)"', get_roles)) == {r.value for r in SCORECARD_READERS}
    for route in ("app/api/staff-scorecards/route.ts", "app/api/staff-scorecards/[id]/route.ts"):
        src = (NEXT_SRC / route).read_text(encoding="utf-8")
        reviewers = re.search(r"const REVIEWER_ROLES: Role\[\] = \[(.*?)\]", src).group(1)
        assert set(re.findall(r'"(\w+)"', reviewers)) == {r.value for r in SCORECARD_REVIEWERS}, route


def test_the_areas_match_the_websites_scorecard():
    src = (NEXT_SRC / "lib/validations.ts").read_text(encoding="utf-8")
    block = src[src.index("export const SCORECARD_AREAS = ["):]
    block = block[: block.index("] as const;")]
    website = [(k, float(w)) for k, w in re.findall(r'key: "(\w+)", weight: ([\d.]+)', block)]
    assert website == list(SCORECARD_AREAS)
    assert round(sum(w for _, w in SCORECARD_AREAS), 2) == 1


# --- scoring (the cases scorecardScoring.test.ts had) --------------------------


def test_the_weighted_score():
    weights = [w for _, w in SCORECARD_AREAS]
    assert overall_score(list(zip(weights, [4, 4, 5, 4, 3, 4, 5], strict=True))) == 4.05
    assert overall_score([(0.5, None), (0.5, 5)]) == 2.5
    assert overall_score([(w, 5) for w in weights]) == 5


@pytest.mark.parametrize(
    ("score", "expected"),
    [
        (5, ("Exceptional", "Recognition")),
        (4.5, ("Exceptional", "Recognition")),
        (4.49, ("Strong", "Maintain")),
        (3, ("Effective", "Coaching")),
        (2, ("Improvement Required", "Improvement Plan")),
        (1, ("Unsatisfactory", "Formal Review")),
        (0, ("Unsatisfactory", "Formal Review")),
    ],
)
def test_the_bands(score, expected):
    assert categorize(score) == expected


# --- drafts ------------------------------------------------------------------


def test_a_supervisor_drafts_a_scorecard_with_every_area(api, team):
    res = draft(api, team, areas=[{"area_key": "quality_accuracy", "rating": 5, "evidence": "Clean records"}])
    assert res.status_code == 201
    data = res.json()["data"]
    assert data["status"] == "draft"
    assert [(a["area_key"], a["weight"]) for a in data["areas"]] == [(k, w) for k, w in SCORECARD_AREAS]
    quality = next(a for a in data["areas"] if a["area_key"] == "quality_accuracy")
    assert (quality["rating"], quality["evidence"]) == (5, "Clean records")
    assert all(a["rating"] is None for a in data["areas"] if a["area_key"] != "quality_accuracy")


def test_a_second_save_updates_only_what_it_sends(api, team):
    first = draft(api, team, areas=[{"area_key": "quality_accuracy", "rating": 5, "evidence": "Clean"}]).json()["data"]
    second = draft(api, team, areas=[{"area_key": "quality_accuracy", "evidence": "Cleaner"}, {"area_key": "professional_conduct", "rating": 3}]).json()["data"]
    assert second["id"] == first["id"]
    areas = {a["area_key"]: a for a in second["areas"]}
    assert (areas["quality_accuracy"]["rating"], areas["quality_accuracy"]["evidence"]) == (5, "Cleaner")
    assert areas["professional_conduct"]["rating"] == 3


@pytest.mark.parametrize(
    "areas",
    [
        [{"area_key": "charisma", "rating": 3}],
        [{"area_key": "quality_accuracy", "rating": 6}],
        [{"area_key": "quality_accuracy", "rating": 3.5}],  # the integer column refused it with a 500
        [{"area_key": "quality_accuracy", "evidence": "x" * 1001}],
        all_rated() + [{"area_key": "quality_accuracy", "rating": 3}],
    ],
)
def test_draft_rules(api, team, areas):
    assert draft(api, team, areas=areas).status_code == 422


def test_only_the_direct_supervisor_or_admin_scores(api, db, team):
    _, other = person(db, Role.country_supervisor)
    refused = api.post(URL, headers=other, json={"staff_id": team["recruiter"].id, "period_month": "2026-10-01", "areas": []})
    assert (refused.status_code, refused.json()["error"]) == (403, {"code": "forbidden", "message": "You can only score your own direct reports."})
    _, admin = person(db, Role.admin)
    assert api.post(URL, headers=admin, json={"staff_id": team["recruiter"].id, "period_month": "2026-10-01", "areas": []}).status_code == 201
    assert api.post(URL, headers=team["rec"], json={"staff_id": team["recruiter"].id, "period_month": "2026-10-01", "areas": []}).status_code == 403
    missing = api.post(URL, headers=team["sup"], json={"staff_id": "cnosuchstaff00", "period_month": "2026-10-01", "areas": []})
    assert (missing.status_code, missing.json()["error"]["message"]) == (404, "Staff member not found.")


# --- finalizing --------------------------------------------------------------


def test_finalizing_scores_categorizes_and_locks(api, team):
    sc = draft(api, team, areas=all_rated(4)).json()["data"]
    res = api.patch(f"{URL}/{sc['id']}", headers=team["sup"], json={"review_date": "2026-11-02"})
    assert res.status_code == 200
    assert res.json()["data"] == {
        "id": sc["id"],
        "status": "finalized",
        "overall_score": 4,
        "performance_category": "Strong",
        "required_action": "Maintain",
        "review_date": "2026-11-02T00:00:00.000Z",
    }
    again = draft(api, team, areas=all_rated(5))
    assert (again.status_code, again.json()["error"]["code"]) == (422, "already_finalized")
    assert api.patch(f"{URL}/{sc['id']}", headers=team["sup"], json={}).json()["error"]["code"] == "already_finalized"


def test_finalizing_defaults_the_review_date_to_now(api, team):
    sc = draft(api, team, areas=all_rated(2)).json()["data"]
    data = api.patch(f"{URL}/{sc['id']}", headers=team["sup"], json={}).json()["data"]
    assert ISO_Z.fullmatch(data["review_date"]) and data["performance_category"] == "Improvement Required"


def test_every_area_must_be_rated_first(api, team):
    sc = draft(api, team, areas=all_rated()[:-1]).json()["data"]
    res = api.patch(f"{URL}/{sc['id']}", headers=team["sup"], json={})
    assert (res.status_code, res.json()["error"]) == (422, {"code": "incomplete", "message": "Every area must be rated before finalizing."})


def test_only_the_author_or_admin_finalizes(api, db, team):
    sc = draft(api, team).json()["data"]
    _, other = person(db, Role.country_supervisor)
    assert api.patch(f"{URL}/{sc['id']}", headers=other, json={}).json()["error"] == {"code": "forbidden", "message": "Forbidden."}
    missing = api.patch(f"{URL}/cnosuchcard000", headers=team["sup"], json={})
    assert (missing.status_code, missing.json()["error"]["message"]) == (404, "Scorecard not found.")
    _, admin = person(db, Role.admin)
    assert api.patch(f"{URL}/{sc['id']}", headers=admin, json={}).status_code == 200


# --- reading -----------------------------------------------------------------


def test_who_sees_which_scorecards(api, db, team):
    mine = draft(api, team).json()["data"]
    others_sup, others_headers = person(db, Role.country_supervisor)
    others_rec, others_rec_headers = person(db, Role.regional_recruiter, supervisor_id=others_sup.id)
    theirs = api.post(URL, headers=others_headers, json={"staff_id": others_rec.id, "period_month": "2026-10-01", "areas": []}).json()["data"]
    _, director = person(db, Role.director)

    def ids(headers, **params):
        return {s["id"] for s in api.get(URL, headers=headers, params=params).json()["data"]}

    assert ids(team["rec"]) == {mine["id"]}  # their own
    assert mine["id"] in ids(team["sup"]) and theirs["id"] not in ids(team["sup"])  # the ones they authored
    assert {mine["id"], theirs["id"]} <= ids(director)
    assert ids(director, staff_id=team["recruiter"].id) == {mine["id"]}
    row = api.get(URL, headers=team["rec"]).json()["data"][0]
    assert row["staff"] == {"id": team["recruiter"].id, "full_name": team["recruiter"].full_name, "role": "regional_recruiter"}
    assert row["reviewer"]["id"] == team["supervisor"].id and len(row["areas"]) == 7 and "id" in row["areas"][0]


@pytest.mark.parametrize("role", list(Role))
def test_who_may_read_and_review(api, db, role):
    _, headers = person(db, role)
    assert api.get(URL, headers=headers).status_code == (200 if role in SCORECARD_READERS else 403)
    if role not in SCORECARD_REVIEWERS:
        assert api.patch(f"{URL}/cnosuchcard000", headers=headers, json={}).status_code == 403


# --- audit -------------------------------------------------------------------


def test_drafts_and_finalizing_are_on_the_trail_as_vertex_api(api, db, team):
    actor = team["supervisor"].id
    db.execute(text("SET LOCAL ROLE vertex_api"))
    try:
        sc = draft(api, team).json()["data"]
        fin = api.patch(f"{URL}/{sc['id']}", headers=team["sup"], json={})
    finally:
        db.execute(text("RESET ROLE"))
    assert fin.status_code == 200

    def trail(entity_id):
        return [(e.action, e.actor_id) for e in db.scalars(select(AuditLog).where(AuditLog.entity_id == entity_id).order_by(AuditLog.created_at, AuditLog.id))]

    assert trail(sc["id"]) == [("create", actor), ("update", actor)]
    area = db.scalars(select(StaffScorecardArea).where(StaffScorecardArea.scorecard_id == sc["id"])).first()
    assert trail(area.id) == [("create", actor)]
    assert db.get(StaffScorecard, sc["id"]).performance_category == "Strong"
