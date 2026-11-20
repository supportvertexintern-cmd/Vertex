"""Management's partner money and performance (Phase 6, upstream staging):
one partner's commission statement and the performance of every partner
and team member. Only what's earned so far counts; future deployment months
are shown as scheduled; flags agree with the VA dashboard's."""

from __future__ import annotations

import re
import secrets
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.api.v1.partner_tracking import MANAGERS
from app.core.clock import utc_now_ms
from app.core.config import BASE_DIR
from app.db.session import get_db
from app.main import app
from app.models.audit import AuditLog
from app.models.candidate import Candidate
from app.models.enums import AdminFeeType, CommissionStatus, MouStatus, PartnerCommissionRuleType, PartnerStatus, PartnerType, Role, SlaStatus
from app.models.identity import User
from app.models.partner_tracking import AdminFee, PartnerCommission
from app.models.partners import Partner
from app.services.partner_flags import current_period
from tests.test_auth import add_session, bearer, session_token
from tests.test_db_roles import roles_provisioned  # noqa: F401  (vertex_api must exist)

URL = "/api/v1"
NEXT_API = BASE_DIR.parent / "vertex" / "src" / "app" / "api"
REG = PartnerCommissionRuleType.registration
MONTHLY = PartnerCommissionRuleType.monthly_deployment


@pytest.fixture
def api(db, client):
    app.dependency_overrides[get_db] = lambda: db
    yield client
    app.dependency_overrides.pop(get_db, None)


def person(db, role: Role, name: str | None = None) -> tuple[User, dict[str, str]]:
    u = User(full_name=name or f"Perf {secrets.token_hex(2)}", email=f"pp-{secrets.token_hex(4)}@test.invalid", role=role)
    db.add(u)
    db.flush()
    db.refresh(u)
    return u, bearer(session_token(u.id, add_session(db, u.id).family_id, u.token_version))


def agency(db, name: str, keeper: User | None = None, **fields) -> Partner:
    p = Partner(name=name, partner_type=PartnerType.manpower_supplier, country_of_operation="Kenya", contact_name="Pat",
                contact_email=f"pp-{secrets.token_hex(3)}@test.invalid", contact_phone="1", status=PartnerStatus.active,
                assigned_team_member_id=keeper.id if keeper else None, **fields)
    db.add(p)
    db.flush()
    return p


def months_from_now(n: int) -> str:
    now = utc_now_ms()
    total = now.year * 12 + now.month - 1 + n
    return f"{total // 12}-{total % 12 + 1:02d}"


@pytest.fixture
def ledger(db):
    """One partner with a mixed ledger: registrations in each status, a
    deployed candidate's six months (two past, the current one, three ahead),
    a rejected row, and admin fees due and not yet due."""
    va, as_va = person(db, Role.virtual_assistant, "Perf VA")
    _, director = person(db, Role.director)
    rich = agency(db, f"Rich Agency {secrets.token_hex(2)}", va, mou_status=MouStatus.signed, sla_status=SlaStatus.signed, documents_submitted_at=utc_now_ms())
    poor = agency(db, f"Poor Agency {secrets.token_hex(2)}", va)
    alone = agency(db, f"Alone Agency {secrets.token_hex(2)}")
    a, b, c = (Candidate(full_name=f"Cand {n}", partner_id=rich.id) for n in "abc")
    db.add_all([a, b, c])
    db.flush()

    def commission(partner, candidate, rule, period, amount, status):
        db.add(PartnerCommission(partner_id=partner.id, candidate_id=candidate.id, rule_type=rule, period=period, amount=Decimal(amount), status=status))

    now = current_period(utc_now_ms())
    commission(rich, a, REG, now, "10", CommissionStatus.paid)
    commission(rich, b, REG, now, "10", CommissionStatus.approved)
    commission(rich, c, REG, now, "10", CommissionStatus.pending)
    commission(rich, c, REG, months_from_now(-1), "10", CommissionStatus.rejected)  # never earned (one row a month: the unique key)
    for offset, status in ((-2, CommissionStatus.paid), (-1, CommissionStatus.approved), (0, CommissionStatus.pending),
                           (1, CommissionStatus.pending), (2, CommissionStatus.pending), (3, CommissionStatus.pending)):
        commission(rich, a, MONTHLY, months_from_now(offset), "40", status)
    db.add_all([
        AdminFee(partner_id=rich.id, candidate_id=a.id, fee_type=AdminFeeType.application, period=now, amount=Decimal("25"), status=CommissionStatus.paid),
        AdminFee(partner_id=rich.id, candidate_id=a.id, fee_type=AdminFeeType.deployment_monthly, period=months_from_now(-1), amount=Decimal("5"), status=CommissionStatus.pending),
        AdminFee(partner_id=rich.id, candidate_id=a.id, fee_type=AdminFeeType.deployment_monthly, period=months_from_now(2), amount=Decimal("5"), status=CommissionStatus.pending),
    ])
    db.flush()
    return {"va": va, "as_va": as_va, "director": director, "rich": rich, "poor": poor, "alone": alone}


def next_roles(route: str) -> set[str]:
    src = (NEXT_API / route / "route.ts").read_text(encoding="utf-8")
    lists = [frozenset(re.findall(r'"(\w+)"', m)) for m in re.findall(r"requireRole\(user, \[(.*?)\]\)", src, re.S)]
    assert lists and len(set(lists)) == 1, route
    return set(lists[0])


def test_the_roles_match_next_js():
    for route in ("management/partners/[id]/commission-statement", "management/partner-performance"):
        assert next_roles(route) == {r.value for r in MANAGERS}, route


# --- the statement -------------------------------------------------------------------


def test_the_statement_counts_only_what_is_earned(api, ledger):
    s = api.get(f"{URL}/partners/{ledger['rich'].id}/commission-statement", headers=ledger["director"]).json()["data"]["summary"]
    assert (s["registered_candidates"], s["deployed_candidates"]) == (3, 1)
    assert (s["registration_commissions"], s["monthly_deployment_commissions"]) == (30.0, 120.0)  # 3 x 10; 3 months x 40
    assert (s["months_earned"], s["months_scheduled"], s["scheduled_commissions"]) == (3, 3, 120.0)  # three months still ahead
    assert s["total_earned"] == 150.0
    assert (s["paid"], s["approved"], s["pending"], s["outstanding"]) == (50.0, 50.0, 50.0, 100.0)


def test_the_statement_lists_the_ledger_with_names_and_records_who_looked(api, db, ledger):
    data = api.get(f"{URL}/partners/{ledger['rich'].id}/commission-statement", headers=ledger["director"]).json()["data"]
    assert len(data["history"]) == 10
    assert {h["candidate"]["full_name"] for h in data["history"]} == {"Cand a", "Cand b", "Cand c"}
    assert data["partner"]["assigned_team_member"]["full_name"] == "Perf VA"
    viewed = db.scalars(select(AuditLog).where(AuditLog.action == "statement_viewed", AuditLog.entity_id == ledger["rich"].id)).all()
    assert len(viewed) == 1
    # A view isn't a change: the partner's activity feed doesn't show it.
    feed = api.get(f"{URL}/partners/{ledger['rich'].id}/tracking", headers=ledger["director"]).json()["data"]["activity"]
    assert all(a["action"] != "statement_viewed" for a in feed)


def test_the_statement_is_the_managers(api, ledger):
    assert api.get(f"{URL}/partners/{ledger['rich'].id}/commission-statement", headers=ledger["as_va"]).status_code == 403
    assert api.get(f"{URL}/partners/no-such/commission-statement", headers=ledger["director"]).status_code == 404


# --- performance ---------------------------------------------------------------------


def performance(api, ledger) -> dict:
    return api.get(f"{URL}/partner-performance", headers=ledger["director"]).json()["data"]


def test_partners_are_ranked_by_what_they_earned(api, ledger):
    data = performance(api, ledger)
    mine = [r for r in data["ranked"] if r["partner_id"] in {ledger["rich"].id, ledger["poor"].id, ledger["alone"].id}]
    assert mine[0]["partner_id"] == ledger["rich"].id
    rich = mine[0]
    assert (rich["registered"], rich["deployed_candidates"], rich["commissions_earned"], rich["commissions_paid"], rich["commissions_outstanding"]) == (3, 1, 150.0, 50.0, 100.0)
    assert rich["onboarding"] == {"documents_submitted": True, "mou_signed": True, "sla_signed": True}


def test_the_flags_are_the_va_dashboards(api, ledger):
    # DEF-006: one rule, so the rollup can't disagree with the VA's own view.
    data = performance(api, ledger)
    flagged = {f["partner_id"]: f["flags"] for f in api.get(f"{URL}/va/overview", headers=ledger["as_va"]).json()["data"]["flags"]}
    for row in data["ranked"]:
        if row["partner_id"] in (ledger["rich"].id, ledger["poor"].id):
            assert row["flags"] == flagged.get(row["partner_id"], []), row["partner_name"]


def test_each_team_member_rolls_up_its_partners(api, ledger):
    team = {t["team_member"]: t for t in performance(api, ledger)["teamPerformance"]}
    va = team["Perf VA"]
    assert (va["partners_assigned"], va["outstanding"]) == (2, 100.0)
    assert va["flagged"] >= 1  # the poor agency has nothing signed
    assert team["Unassigned"]["partners_assigned"] >= 1


def test_the_totals_count_earned_commissions_and_due_fees(api, ledger):
    totals = performance(api, ledger)["totals"]
    # Other tests' rows may share the database: compare against at least ours.
    assert totals["commissions_paid"] >= 50.0 and totals["commissions_outstanding"] >= 100.0
    assert totals["admin_fee_revenue"] >= 30.0 and totals["admin_fee_collected"] >= 25.0


def test_performance_is_the_managers(api, ledger):
    assert api.get(f"{URL}/partner-performance", headers=ledger["as_va"]).status_code == 403
