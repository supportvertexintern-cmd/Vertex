"""Referral commissions at pipeline milestones (step 6.1, ported from the
website's generateReferralCommissionIfDue, which the switch removed), and
the pipeline's switch: on since step 6.7, and it can be turned off."""

import secrets

import pytest
from sqlalchemy import select

from app.core import pipeline
from app.core.api import ApiError
from app.core.config import settings
from app.models.audit import AuditLog
from app.models.candidate import Candidate
from app.models.enums import ReferralCommissionStatus, ReferralMilestone, Role
from app.models.identity import Country, Region, User
from app.models.referral import ReferralAgent, ReferralCommission, ReferralCommissionRule
from app.services.referrals import commission_if_due

@pytest.fixture
def referred(db):
    region = Region(name=f"Ref region {secrets.token_hex(3)}")
    db.add(region)
    db.flush()
    country = Country(name=f"Ref land {secrets.token_hex(3)}", region_id=region.id)
    agent = ReferralAgent(
        full_name="Amina Agent", email=f"agent-{secrets.token_hex(3)}@test.invalid", phone="1", country="Kenya", referral_code=f"REF{secrets.token_hex(3)}"
    )
    db.add_all([country, agent])
    db.flush()
    candidate = Candidate(full_name="Referred Person", country_id=country.id, referral_agent_id=agent.id)
    db.add(candidate)
    db.flush()
    admin = User(full_name="Rule setter", email=f"rules-{secrets.token_hex(3)}@test.invalid", role=Role.admin)
    db.add(admin)
    db.flush()
    return {"country": country, "agent": agent, "candidate": candidate, "admin": admin}


def commissions(db, candidate_id):
    return list(db.scalars(select(ReferralCommission).where(ReferralCommission.candidate_id == candidate_id)))


def test_a_paid_milestone_records_a_pending_commission_and_asks_for_the_email(db, referred):
    db.add(ReferralCommissionRule(country_id=referred["country"].id, milestone=ReferralMilestone.qualified, amount=50, currency="GBP", updated_by=referred["admin"].id))
    db.flush()
    earned = commission_if_due(db, referred["candidate"].id, ReferralMilestone.qualified)
    assert earned is not None
    assert (earned.agent_email, earned.candidate_name, earned.amount, earned.currency) == (referred["agent"].email, "Referred Person", 50, "GBP")
    [row] = commissions(db, referred["candidate"].id)
    assert (row.status, row.amount, row.paid_at, row.commission_rule_id is not None) == (ReferralCommissionStatus.pending, 50, None, True)


def test_a_milestone_is_earned_once(db, referred):
    commission_if_due(db, referred["candidate"].id, ReferralMilestone.qualified)
    assert commission_if_due(db, referred["candidate"].id, ReferralMilestone.qualified) is None
    assert len(commissions(db, referred["candidate"].id)) == 1


def test_no_rule_is_a_paid_zero_that_still_counts(db, referred):
    assert commission_if_due(db, referred["candidate"].id, ReferralMilestone.deployed, case_id=None) is None  # no email
    [row] = commissions(db, referred["candidate"].id)
    assert (row.status, row.amount, row.currency, row.paid_at is not None) == (ReferralCommissionStatus.paid, 0, "USD", True)


def test_a_candidate_nobody_referred_earns_nothing(db):
    plain = Candidate(full_name="Walk-in")
    db.add(plain)
    db.flush()
    assert commission_if_due(db, plain.id, ReferralMilestone.qualified) is None
    assert commissions(db, plain.id) == []
    assert commission_if_due(db, "cnosuchcandidate", ReferralMilestone.qualified) is None


def test_the_commission_is_on_the_trail(db, referred):
    commission_if_due(db, referred["candidate"].id, ReferralMilestone.qualified)
    [row] = commissions(db, referred["candidate"].id)
    assert db.scalars(select(AuditLog.action).where(AuditLog.entity_id == row.id)).all() == ["create"]


# --- the switch --------------------------------------------------------------


def test_the_pipeline_switch_is_on_and_can_be_turned_off(monkeypatch):
    """On since step 6.7; off is the rollback, and every pipeline write then
    answers 503."""
    assert settings.PIPELINE_WRITES_ENABLED is True
    assert pipeline.pipeline_writes_enabled() is None
    monkeypatch.setattr(settings, "PIPELINE_WRITES_ENABLED", False)
    with pytest.raises(ApiError) as refused:
        pipeline.pipeline_writes_enabled()
    assert (refused.value.status_code, refused.value.code) == (503, "pipeline_not_enabled")
