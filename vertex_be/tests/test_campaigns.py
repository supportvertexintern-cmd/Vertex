"""Campaigns and their targets (step 5.1) answer as Next.js's /api/campaigns
routes did: the same roles, scoping, rules, messages, status codes and
JSON."""

import re
import secrets

import pytest
from sqlalchemy import select, text

from app.api.v1.campaigns import CAMPAIGN_MANAGERS, CAMPAIGN_READERS
from app.core.config import BASE_DIR
from app.db.session import get_db
from app.main import app
from app.models.audit import AuditLog
from app.models.campaign import Campaign, CampaignTarget, RecruiterTarget
from app.models.enums import Role
from app.models.identity import Country, InhouseCountryAssignment, Region, User
from tests.test_auth import add_session, bearer, session_token
from tests.test_db_roles import roles_provisioned  # noqa: F401  (vertex_api must exist)

NEXT_CAMPAIGNS = BASE_DIR.parent / "vertex" / "src" / "app" / "api" / "campaigns"
ISO_Z = re.compile(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z")
URL = "/api/v1/campaigns"


@pytest.fixture
def api(db, client):
    app.dependency_overrides[get_db] = lambda: db
    yield client
    app.dependency_overrides.pop(get_db, None)


def staff(db, role: Role, **fields) -> tuple[User, dict[str, str]]:
    u = User(full_name=f"{role.value} test", email=f"camp-{secrets.token_hex(4)}@test.invalid", role=role, **fields)
    db.add(u)
    db.flush()
    db.refresh(u)
    s = add_session(db, u.id)
    return u, bearer(session_token(u.id, s.family_id, u.token_version))


@pytest.fixture
def places(db):
    region = Region(name=f"Camp region {secrets.token_hex(3)}")
    other_region = Region(name=f"Other region {secrets.token_hex(3)}")
    db.add_all([region, other_region])
    db.flush()
    home = Country(name=f"Home {secrets.token_hex(3)}", region_id=region.id)
    away = Country(name=f"Away {secrets.token_hex(3)}", region_id=other_region.id)
    db.add_all([home, away])
    db.flush()
    return {"region": region, "other_region": other_region, "home": home, "away": away}


@pytest.fixture
def director(db):
    return staff(db, Role.director)


@pytest.fixture
def inhouse(db, places):
    user, headers = staff(db, Role.inhouse_supervisor)
    db.add(InhouseCountryAssignment(inhouse_supervisor_id=user.id, country_id=places["home"].id))
    db.flush()
    return user, headers


def new_campaign(**fields) -> dict:
    return {"name": f"Spring drive {secrets.token_hex(3)}", "start_date": "2026-11-01", "end_date": "2026-12-31"} | fields


def roles_of(src: str, const: str) -> set[str]:
    return set(re.findall(r'"(\w+)"', re.search(rf"const {const} = \[(.*?)\]", src).group(1)))


def test_the_roles_match_next_js():
    src = (NEXT_CAMPAIGNS / "route.ts").read_text(encoding="utf-8")
    assert roles_of(src, "STAFF_ROLES") == {r.value for r in CAMPAIGN_READERS}
    for route in ("route.ts", "[id]/route.ts", "[id]/targets/route.ts", "[id]/targets/[targetId]/route.ts"):
        src = (NEXT_CAMPAIGNS / route).read_text(encoding="utf-8")
        assert roles_of(src, "CAMPAIGN_MANAGER_ROLES") == {r.value for r in CAMPAIGN_MANAGERS}, route


# --- campaigns ---------------------------------------------------------------


def test_a_director_creates_a_campaign(api, director):
    user, headers = director
    res = api.post(URL, headers=headers, json=new_campaign(criteria={"roles": ["picker"]}))
    assert res.status_code == 201
    data = res.json()["data"]
    assert set(data) == {"id", "name", "status", "start_date", "end_date"}
    assert (data["status"], data["start_date"]) == ("draft", "2026-11-01T00:00:00.000Z")

    detail = api.get(f"{URL}/{data['id']}", headers=headers).json()["data"]
    assert detail["criteria"] == {"roles": ["picker"]}
    assert detail["creator"] == {"id": user.id, "full_name": user.full_name}
    assert detail["targets"] == []


def test_an_offset_is_stored_in_utc(api, director):
    data = api.post(URL, headers=director[1], json=new_campaign(start_date="2026-11-01T03:00:00+03:00")).json()["data"]
    assert data["start_date"] == "2026-11-01T00:00:00.000Z"


@pytest.mark.parametrize(
    ("fields", "field"),
    [
        ({"end_date": "2026-10-01"}, "end_date"),
        ({"end_date": "2026-11-01"}, "end_date"),
        ({"name": "ab"}, "name"),
        ({"start_date": "soon"}, "start_date"),
    ],
)
def test_create_rules(api, director, fields, field):
    res = api.post(URL, headers=director[1], json=new_campaign(**fields))
    assert res.status_code == 422
    assert field in res.json()["error"]["details"]


def test_an_edit_keeps_the_timeline_bounded(api, director):
    created = api.post(URL, headers=director[1], json=new_campaign()).json()["data"]
    ok = api.patch(f"{URL}/{created['id']}", headers=director[1], json={"status": "active", "end_date": "2027-01-31", "start_date": ""})
    assert (ok.status_code, ok.json()["data"]["status"], ok.json()["data"]["end_date"]) == (200, "active", "2027-01-31T00:00:00.000Z")
    bad = api.patch(f"{URL}/{created['id']}", headers=director[1], json={"start_date": "2027-02-01"})
    assert (bad.status_code, list(bad.json()["error"]["details"])) == (422, ["end_date"])


def test_an_inhouse_supervisor_edits_only_their_own(api, db, director, inhouse):
    theirs = api.post(URL, headers=director[1], json=new_campaign()).json()["data"]
    mine = api.post(URL, headers=inhouse[1], json=new_campaign()).json()["data"]
    assert api.patch(f"{URL}/{mine['id']}", headers=inhouse[1], json={"name": "Renamed drive"}).status_code == 200
    refused = api.patch(f"{URL}/{theirs['id']}", headers=inhouse[1], json={"name": "Not mine"})
    assert (refused.status_code, refused.json()["error"]) == (403, {"code": "forbidden", "message": "You can only edit campaigns you created."})
    gone = api.delete(f"{URL}/{theirs['id']}", headers=inhouse[1])
    assert gone.json()["error"]["message"] == "You can only delete campaigns you created."
    assert api.delete(f"{URL}/{mine['id']}", headers=inhouse[1]).json() == {"data": {"id": mine["id"]}}
    assert api.delete(f"{URL}/{mine['id']}", headers=director[1]).status_code == 404


def test_the_list_filters_by_status_newest_first(api, db, director):
    first = api.post(URL, headers=director[1], json=new_campaign()).json()["data"]
    # One test transaction gives both the same CURRENT_TIMESTAMP.
    db.execute(text("""UPDATE "Campaign" SET created_at = created_at - interval '1 minute' WHERE id = :id"""), {"id": first["id"]})
    second = api.post(URL, headers=director[1], json=new_campaign()).json()["data"]
    api.patch(f"{URL}/{second['id']}", headers=director[1], json={"status": "active"})
    rows = api.get(URL, headers=director[1]).json()["data"]
    ids = [r["id"] for r in rows]
    assert ids.index(second["id"]) < ids.index(first["id"])
    active = [r["id"] for r in api.get(URL, headers=director[1], params={"status": "active"}).json()["data"]]
    assert second["id"] in active and first["id"] not in active
    assert api.get(URL, headers=director[1], params={"status": "archived"}).status_code == 422


def test_scope_mine_keeps_what_applies_to_the_caller(api, db, director, places):
    _, recruiter = staff(db, Role.regional_recruiter, assigned_country_id=places["home"].id)

    def campaign_with(**scope):
        c = api.post(URL, headers=director[1], json=new_campaign()).json()["data"]
        api.post(f"{URL}/{c['id']}/targets", headers=director[1], json={"metric": "verified_candidates", "target_value": 10, **scope})
        return c["id"]

    country = campaign_with(country_id=places["home"].id)
    region = campaign_with(region_id=places["region"].id)
    wide = campaign_with()
    elsewhere = campaign_with(country_id=places["away"].id)
    untargeted = api.post(URL, headers=director[1], json=new_campaign()).json()["data"]["id"]

    mine = {r["id"] for r in api.get(URL, headers=recruiter, params={"scope": "mine"}).json()["data"]}
    assert {country, region, wide} <= mine
    assert not {elsewhere, untargeted} & mine


@pytest.mark.parametrize("role", list(Role))
def test_who_reads_and_who_creates(api, db, role):
    _, headers = staff(db, role)
    assert api.get(URL, headers=headers).status_code == (200 if role in CAMPAIGN_READERS else 403)
    assert api.post(URL, headers=headers, json=new_campaign()).status_code == (201 if role in CAMPAIGN_MANAGERS else 403)


def test_a_missing_campaign(api, director):
    for res in (
        api.get(f"{URL}/cnosuchcampaign", headers=director[1]),
        api.patch(f"{URL}/cnosuchcampaign", headers=director[1], json={"name": "Nope drive"}),
        api.post(f"{URL}/cnosuchcampaign/targets", headers=director[1], json={"metric": "verified_candidates", "target_value": 1}),
    ):
        assert (res.status_code, res.json()["error"]["message"]) == (404, "Campaign not found.")


# --- targets -----------------------------------------------------------------


def test_a_director_targets_a_country_a_region_or_the_whole_campaign(api, director, places):
    c = api.post(URL, headers=director[1], json=new_campaign()).json()["data"]
    country = api.post(f"{URL}/{c['id']}/targets", headers=director[1], json={"metric": "verified_candidates", "target_value": 25, "country_id": places["home"].id})
    assert country.status_code == 201
    assert country.json()["data"] == {
        "id": country.json()["data"]["id"],
        "metric": "verified_candidates",
        "target_value": 25,
        "country": {"id": places["home"].id, "name": places["home"].name},
        "region": None,
    }
    region = api.post(f"{URL}/{c['id']}/targets", headers=director[1], json={"metric": "conversion_rate", "target_value": 0.4, "region_id": places["region"].id})
    assert region.json()["data"]["region"]["id"] == places["region"].id
    both = api.post(f"{URL}/{c['id']}/targets", headers=director[1], json={"metric": "verified_candidates", "target_value": 1, "country_id": places["home"].id, "region_id": places["region"].id})
    assert both.status_code == 422


@pytest.mark.parametrize("body", [{"metric": "signups", "target_value": 1}, {"metric": "verified_candidates", "target_value": 0}, {"metric": "verified_candidates", "target_value": 1, "country_id": "x"}])
def test_target_rules(api, director, body):
    c = api.post(URL, headers=director[1], json=new_campaign()).json()["data"]
    assert api.post(f"{URL}/{c['id']}/targets", headers=director[1], json=body).status_code == 422


def test_an_inhouse_supervisor_targets_only_their_own_countries(api, db, director, inhouse, places):
    c = api.post(URL, headers=director[1], json=new_campaign()).json()["data"]
    targets = f"{URL}/{c['id']}/targets"
    defaulted = api.post(targets, headers=inhouse[1], json={"metric": "verified_candidates", "target_value": 5}).json()["data"]
    assert defaulted["country"]["id"] == places["home"].id

    for scope in ({"country_id": places["away"].id}, {"region_id": places["region"].id}):
        refused = api.post(targets, headers=inhouse[1], json={"metric": "verified_candidates", "target_value": 5, **scope})
        assert refused.json()["error"] == {"code": "forbidden", "message": "You can only set targets for one of your own assigned countries."}

    db.add(InhouseCountryAssignment(inhouse_supervisor_id=inhouse[0].id, country_id=places["away"].id))
    db.flush()
    ambiguous = api.post(targets, headers=inhouse[1], json={"metric": "verified_candidates", "target_value": 5})
    assert (ambiguous.status_code, ambiguous.json()["error"]["message"]) == (422, "Specify which of your assigned countries this target is for.")

    away = api.post(f"{URL}/{c['id']}/targets", headers=director[1], json={"metric": "verified_candidates", "target_value": 5, "region_id": places["region"].id}).json()["data"]
    refused = api.delete(f"{targets}/{away['id']}", headers=inhouse[1])
    assert refused.json()["error"]["message"] == "You can only remove targets for one of your own assigned countries."
    assert api.delete(f"{targets}/{defaulted['id']}", headers=inhouse[1]).json() == {"data": {"id": defaulted["id"]}}


def test_an_unassigned_inhouse_supervisor(api, db, director):
    _, headers = staff(db, Role.inhouse_supervisor)
    c = api.post(URL, headers=director[1], json=new_campaign()).json()["data"]
    res = api.post(f"{URL}/{c['id']}/targets", headers=headers, json={"metric": "verified_candidates", "target_value": 5})
    assert (res.status_code, res.json()["error"]) == (422, {"code": "no_country", "message": "You must be assigned a country first."})


def test_a_target_from_another_campaign_is_not_found(api, director):
    a = api.post(URL, headers=director[1], json=new_campaign()).json()["data"]
    b = api.post(URL, headers=director[1], json=new_campaign()).json()["data"]
    t = api.post(f"{URL}/{a['id']}/targets", headers=director[1], json={"metric": "verified_candidates", "target_value": 5}).json()["data"]
    res = api.delete(f"{URL}/{b['id']}/targets/{t['id']}", headers=director[1])
    assert (res.status_code, res.json()["error"]["message"]) == (404, "Target not found.")


# --- audit -------------------------------------------------------------------


def test_deleting_a_campaign_records_each_target_and_allocation(api, db, director, places):
    actor, headers = director
    c = api.post(URL, headers=headers, json=new_campaign()).json()["data"]
    t = api.post(f"{URL}/{c['id']}/targets", headers=headers, json={"metric": "verified_candidates", "target_value": 5, "country_id": places["home"].id}).json()["data"]
    recruiter, _ = staff(db, Role.regional_recruiter)
    allocation = RecruiterTarget(campaign_target_id=t["id"], recruiter_id=recruiter.id, target_value=2, set_by=actor.id)
    db.add(allocation)
    db.flush()

    assert api.delete(f"{URL}/{c['id']}", headers=headers).status_code == 200
    assert db.get(Campaign, c["id"]) is None and db.get(CampaignTarget, t["id"]) is None and db.get(RecruiterTarget, allocation.id) is None

    def trail(entity_id):
        return [(e.action, e.actor_id) for e in db.scalars(select(AuditLog).where(AuditLog.entity_id == entity_id).order_by(AuditLog.created_at, AuditLog.id))]

    assert trail(c["id"]) == [("create", actor.id), ("delete", actor.id)]
    assert trail(t["id"]) == [("create", actor.id), ("delete", actor.id)]
    assert trail(allocation.id)[-1] == ("delete", actor.id)


def test_the_api_database_role_can_write_them(api, db, director, places):
    db.execute(text("SET LOCAL ROLE vertex_api"))
    try:
        c = api.post(URL, headers=director[1], json=new_campaign())
        t = api.post(f"{URL}/{c.json()['data']['id']}/targets", headers=director[1], json={"metric": "verified_candidates", "target_value": 5})
        d = api.delete(f"{URL}/{c.json()['data']['id']}", headers=director[1])
    finally:
        db.execute(text("RESET ROLE"))
    assert (c.status_code, t.status_code, d.status_code) == (201, 201, 200)
