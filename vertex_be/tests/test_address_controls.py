"""Login protection, PR 5 (4.3): address controls. Admins block or allow an
address or range with a reason (a block for 1 to 30 days, never covering
their own address; ranges capped), remove one with a reason, and see and
clear the website's per-address limits in Redis. The website reads the
active rules on its service credential. Admins only; every change audited."""

from __future__ import annotations

import fnmatch
import secrets

import pytest
from sqlalchemy import select

from app.models.audit import AuditLog
from app.models.enums import Role
from app.services import address_controls
from tests.test_account_monitoring import admin, signed_in  # noqa: F401  (fixtures)
from tests.test_auth import bearer
from tests.test_sessions import IP, account, api, google, svc  # noqa: F401  (fixtures)

M = "/api/v1/monitoring/addresses"


class FakeRedis:
    """What address_controls uses: SCAN, GET, PTTL, DEL."""

    def __init__(self, data: dict, ttl_ms: int = 42_000):
        self.data, self.ttl_ms = data, ttl_ms

    def scan_iter(self, match: str, count: int = 0):
        return [k for k in list(self.data) if fnmatch.fnmatch(k, match)]

    def get(self, key):
        return self.data.get(key)

    def pttl(self, key):
        return self.ttl_ms if key in self.data else -2

    def delete(self, *keys):
        return sum(self.data.pop(k, None) is not None for k in keys)


def add(api, headers, **body):
    return api.post(f"{M}/controls", headers={**headers, **svc()}, json={"reason": "Seen in Sign-in Activity", **body})


@pytest.mark.parametrize("role", [Role.director, Role.inhouse_supervisor, Role.partner])
def test_only_admins(api, db, role):
    headers = bearer(signed_in(api, account(db, role=role))[0])
    assert api.get(f"{M}/controls", headers=headers).status_code == 403
    assert add(api, headers, network="198.51.100.1", kind="block", days=1).status_code == 403
    assert api.request("DELETE", f"{M}/controls/x", headers=headers, json={"reason": "why"}).status_code == 403
    assert api.get(f"{M}/limited", headers=headers).status_code == 403
    assert api.post(f"{M}/limited/login:{'a' * 32}:1/clear", headers=headers, json={"reason": "why"}).status_code == 403


def test_only_the_website_reads_the_active_rules(api, db):
    assert api.get("/api/v1/address-controls").status_code in (401, 403)
    assert api.get("/api/v1/address-controls", headers=svc()).status_code == 200


def test_a_block_needs_a_reason_and_an_expiry_and_never_covers_your_own_address(api, db, admin):
    _, headers = admin
    assert add(api, headers, network="198.51.100.7", kind="block").status_code == 422  # no expiry
    assert add(api, headers, network="198.51.100.7", kind="block", days=31).status_code == 422
    assert api.post(f"{M}/controls", headers={**headers, **svc()}, json={"network": "198.51.100.7", "kind": "block", "days": 1}).status_code == 422
    own = add(api, headers, network=f"{IP}/24", kind="block", days=1)  # svc() forwards IP as the admin's address
    assert own.status_code == 422 and own.json()["error"]["code"] == "own_address"
    assert add(api, headers, network="not-an-address", kind="block", days=1).status_code == 422
    assert add(api, headers, network="10.0.0.0/8", kind="block", days=1).status_code == 422  # wider than a /16

    res = add(api, headers, network="198.51.100.7", kind="block", days=7)
    assert res.status_code == 201, res.text
    rule = res.json()["data"]
    assert (rule["network"], rule["kind"], rule["active"]) == ("198.51.100.7/32", "block", True) and rule["expires_at"]
    feed = api.get("/api/v1/address-controls", headers=svc()).json()["data"]
    assert {"network": "198.51.100.7/32", "kind": "block"} in feed


def test_an_allow_is_no_wider_than_a_24(api, db, admin):
    _, headers = admin
    assert add(api, headers, network="203.0.113.0/23", kind="allow").status_code == 422
    res = add(api, headers, network="203.0.113.0/24", kind="allow")
    assert res.status_code == 201 and res.json()["data"]["expires_at"] is None  # an allow may have no expiry
    assert add(api, headers, network="2001:db8::/63", kind="allow").status_code == 422
    assert add(api, headers, network="2001:db8::/64", kind="allow").status_code == 201


def test_removing_a_rule_needs_a_reason_and_keeps_its_history(api, db, admin):
    me, headers = admin
    rule = add(api, headers, network=f"198.51.{secrets.randbelow(200)}.9", kind="block", days=2).json()["data"]
    assert api.request("DELETE", f"{M}/controls/{rule['id']}", headers=headers, json={}).status_code == 422
    res = api.request("DELETE", f"{M}/controls/{rule['id']}", headers={**headers, **svc()}, json={"reason": "Owner's office"})
    assert res.status_code == 200
    gone = res.json()["data"]
    assert gone["active"] is False and gone["removed_by"]["id"] == me.id and gone["removed_reason"] == "Owner's office"
    assert api.request("DELETE", f"{M}/controls/{rule['id']}", headers=headers, json={"reason": "again"}).status_code == 409
    assert rule["id"] not in {r["id"] for r in api.get(f"{M}/controls", headers=headers).json()["data"]}
    assert rule["id"] in {r["id"] for r in api.get(f"{M}/controls", headers=headers, params={"include_ended": True}).json()["data"]}
    assert {"network": rule["network"], "kind": "block"} not in api.get("/api/v1/address-controls", headers=svc()).json()["data"]
    change = db.scalar(select(AuditLog).where(AuditLog.entity_type == "AddressRule", AuditLog.entity_id == rule["id"], AuditLog.action == "update"))
    assert change.actor_id == me.id


def test_the_limited_addresses_and_clearing_one(api, db, admin, monkeypatch):
    _, headers = admin
    digest = secrets.token_hex(16)
    key = f"login:{digest}:29384756"
    data = {f"development:rl-ip:{key}": b"198.51.100.66", f"development:rl:{key}": b"14", "development:rl:other:x:1": b"3"}
    monkeypatch.setattr(address_controls, "counter_store", lambda: FakeRedis(data))
    assert add(api, headers, network="198.51.100.0/24", kind="block", days=1).status_code == 201

    listed = api.get(f"{M}/limited", headers=headers).json()["data"]
    assert listed["available"] is True
    [row] = listed["rows"]
    assert (row["key"], row["scope"], row["ip"], row["hits"], row["resets_in_seconds"], row["blocked"]) == (key, "login", "198.51.100.66", 14, 42, True)

    assert api.post(f"{M}/limited/{key}/clear", headers=headers, json={}).status_code == 422
    assert api.post(f"{M}/limited/not-a-key/clear", headers=headers, json={"reason": "a reason"}).status_code == 422
    res = api.post(f"{M}/limited/{key}/clear", headers=headers, json={"reason": "Their office, verified"})
    assert res.json()["data"] == {"key": key, "cleared": True}
    assert f"development:rl:{key}" not in data and f"development:rl-ip:{key}" not in data
    assert "development:rl:other:x:1" in data  # nothing else
    assert api.post(f"{M}/limited/{key}/clear", headers=headers, json={"reason": "again"}).json()["data"]["cleared"] is False


def test_without_a_shared_store_the_page_says_so(api, db, admin, monkeypatch):
    _, headers = admin
    monkeypatch.setattr(address_controls, "counter_store", lambda: None)
    assert api.get(f"{M}/limited", headers=headers).json()["data"] == {"available": False, "rows": []}


def test_the_overview_counts_blocks(api, db, admin, monkeypatch):
    _, headers = admin
    monkeypatch.setattr(address_controls, "counter_store", lambda: FakeRedis({}))
    before = api.get("/api/v1/monitoring/overview", headers=headers).json()["data"]
    assert add(api, headers, network=f"198.51.{secrets.randbelow(200)}.3", kind="block", days=1).status_code == 201
    after = api.get("/api/v1/monitoring/overview", headers=headers).json()["data"]
    assert after["addresses_blocked"] == before["addresses_blocked"] + 1 and after["addresses_limited_now"] == 0
