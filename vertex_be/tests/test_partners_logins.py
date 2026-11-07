"""Admin → Monitoring, phase 3 (owner's requirements 2026-11-07, migration
0014): Partners & Logins. One row per agency with when and by whom it was
added, and its login's status, creation and latest sign-in; filters and
search; a CSV of the filtered list, recorded on the trail before it leaves.
Admins only."""

from __future__ import annotations

import csv
import importlib.util
import io
import secrets
from pathlib import Path

import pytest
from sqlalchemy import text

from app.core import audit
from app.models.audit import AuditLog
from app.models.enums import MouStatus, PartnerStatus, PartnerType, Role
from app.models.partners import Partner
from tests.test_account_monitoring import admin, deactivate, signed_in, trail  # noqa: F401  (fixtures)
from tests.test_auth import bearer
from tests.test_sessions import IP, account, api, google  # noqa: F401  (fixtures)

URL = "/api/v1/monitoring/partners"


def agency(db, name: str, *, login=None, country="Kenya", status=PartnerStatus.pending, created_by=None) -> Partner:
    p = Partner(
        name=name, partner_type=PartnerType.manpower_supplier, country_of_operation=country, contact_name="Contact",
        contact_email=f"c-{secrets.token_hex(4)}@test.invalid", contact_phone="N/A", status=status, mou_status=MouStatus.none,
        user_id=login.id if login else None, created_by=created_by,
    )
    db.add(p)
    db.flush()
    return p


def rows(api, headers, **params) -> dict[str, dict]:
    res = api.get(URL, headers=headers, params={"pageSize": 100, **params})
    assert res.status_code == 200, res.text
    return {r["id"]: r for r in res.json()["data"]}


@pytest.mark.parametrize("role", [Role.director, Role.inhouse_supervisor, Role.partner])
def test_only_admins(api, db, role):
    headers = bearer(signed_in(api, account(db, role=role))[0])
    for path in (URL, f"{URL}/options", f"{URL}.csv"):
        assert api.get(path, headers=headers).status_code == 403, path


def test_each_agency_with_who_added_it_and_its_login(api, db, admin):
    me, headers = admin
    stamp = secrets.token_hex(3)
    # added through the API: created_by is the caller
    res = api.post("/api/v1/partners", headers=headers, json={
        "name": f"Agency {stamp} added", "partner_type": "travel_agency", "country_of_operation": "Ghana",
        "contact_name": "Contact Person", "contact_email": f"a-{stamp}@test.invalid", "contact_phone": "N/A",
    })
    assert res.status_code == 201, res.text
    added = res.json()["data"]["id"]
    # its login, created through the API too: the setup email is pending
    assert api.post(f"/api/v1/partners/{added}/provision-account", headers=headers, json={}).status_code == 201

    signed = account(db, role=Role.partner)
    active = agency(db, f"Agency {stamp} active", login=signed)
    signed_in(api, signed)
    off_login = account(db, role=Role.partner)
    off = agency(db, f"Agency {stamp} off", login=off_login)
    assert deactivate(api, headers, off_login.id).status_code == 200
    bare = agency(db, f"Agency {stamp} bare")

    found = rows(api, headers, q=f"Agency {stamp}")
    assert set(found) == {added, active.id, off.id, bare.id}
    assert found[added]["created_by"] == {"id": me.id, "full_name": "Monitoring Admin"}
    assert found[added]["login_status"] == "setup_pending"
    assert found[added]["login"]["created_by"]["id"] == me.id and found[added]["login"]["password_set"] is False
    login = found[active.id]["login"]
    assert found[active.id]["login_status"] == "active" and login["last_sign_in_at"] and login["last_sign_in_ip"] == IP
    assert found[off.id]["login_status"] == "deactivated" and found[off.id]["login"]["deactivated_at"]
    assert (found[bare.id]["login_status"], found[bare.id]["login"]) == ("no_login", None)


def test_filters_and_search(api, db, admin):
    me, headers = admin
    stamp = secrets.token_hex(3)
    login = account(db, role=Role.partner)
    a = agency(db, f"Filter {stamp} A", login=login, country=f"Land {stamp}", status=PartnerStatus.active, created_by=me.id)
    b = agency(db, f"Filter {stamp} B", status=PartnerStatus.suspended)

    def ids(**params):
        return set(rows(api, headers, q=f"Filter {stamp}", **params))

    assert ids() == {a.id, b.id}
    assert ids(country=f"Land {stamp}") == {a.id}
    assert ids(status="suspended") == {b.id}
    assert ids(login_status="no_login") == {b.id}
    assert ids(login_status="setup_pending") == {a.id}
    assert ids(created_by=me.id) == {a.id}
    assert set(rows(api, headers, q=login.email)) == {a.id}  # by the login's email
    options = api.get(f"{URL}/options", headers=headers).json()["data"]
    assert f"Land {stamp}" in options["countries"] and {"id": me.id, "full_name": "Monitoring Admin"} in options["creators"]


def test_the_csv_is_the_filtered_list_recorded_first_and_safe_to_open(api, db, admin):
    me, headers = admin
    stamp = secrets.token_hex(3)
    agency(db, f"CSV {stamp} plain", created_by=me.id)
    agency(db, f"=HYPERLINK(\"x\") CSV {stamp}")
    res = api.get(f"{URL}.csv", headers=headers, params={"q": f"CSV {stamp}"})
    assert res.status_code == 200 and res.headers["content-type"].startswith("text/csv")
    assert "attachment" in res.headers["content-disposition"]
    table = list(csv.reader(io.StringIO(res.text)))
    assert table[0][:3] == ["Agency", "Type", "Country"] and len(table) == 3
    names = {r[0] for r in table[1:]}
    assert f"CSV {stamp} plain" in names and f"'=HYPERLINK(\"x\") CSV {stamp}" in names
    event = trail("action = 'export' AND actor_id = :a AND entity_id = 'partners_and_logins'", a=me.id)[-1]
    assert event["after"]["rows"] == 2 and event["after"]["filters"] == {"search": True}


def test_no_export_if_it_cant_be_recorded(api, db, admin, monkeypatch):
    _, headers = admin

    def broken(*_args, **_kwargs):
        raise RuntimeError("trail down")

    monkeypatch.setattr("app.api.v1.monitoring.append_event", broken)
    res = api.get(f"{URL}.csv", headers=headers)
    assert (res.status_code, res.json()["error"]["code"]) == (503, "audit_unavailable")


def test_the_migration_backfills_who_added_each_agency(db):
    spec = importlib.util.spec_from_file_location("m0014", Path(__file__).parents[1] / "alembic/versions/20261107_0014_partner_created_by.py")
    m0014 = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m0014)
    maker = account(db, role=Role.director)
    old = agency(db, f"Old {secrets.token_hex(3)}")
    db.add(AuditLog(entity_type="Partner", entity_id=old.id, action="create", actor_id=maker.id, after={}))
    db.flush()
    db.execute(text(m0014.CREATED_BY))
    db.refresh(old)
    assert old.created_by == maker.id
    assert "Partner" in audit.AUDITED_MODELS
