"""The screening gate (step 6.2) refuses what screening.ts refuses, in its
words, and screening a candidate records the result, moves them on and
works out the invite and commission emails the website sends."""

import re
import secrets
from datetime import datetime, timedelta

import pytest
from sqlalchemy import select

from app.core.config import BASE_DIR
from app.models.audit import AuditLog
from app.models.candidate import Application, Candidate
from app.models.enums import ApplicationStatus, CandidateLifecycleStatus, ReferralMilestone, Role
from app.models.identity import Country, Region, User
from app.models.jobs import Job
from app.models.referral import ReferralAgent, ReferralCommissionRule
from app.services import screening
from app.services.screening import evaluate_screening_gate, screen_and_invite

SCREENING_TS = (BASE_DIR.parent / "vertex" / "src" / "server" / "services" / "screening.ts").read_text(encoding="utf-8")
NOW = datetime(2026, 10, 29, 12, 0)


def website_messages() -> set[str]:
    constants = {
        "MINIMUM_AGE_YEARS": str(screening.MINIMUM_AGE_YEARS),
        "MINIMUM_PASSPORT_VALIDITY_MONTHS": str(screening.MINIMUM_PASSPORT_VALIDITY_MONTHS),
    }
    found = re.findall(r'failures\.push\(["`](.*?)["`]\)', SCREENING_TS)
    return {re.sub(r"\$\{(\w+)\}", lambda m: constants[m.group(1)], f) for f in found}


def test_the_thresholds_match_the_website():
    assert re.search(r"const MINIMUM_AGE_YEARS = (\d+);", SCREENING_TS).group(1) == str(screening.MINIMUM_AGE_YEARS)
    assert re.search(r"const MINIMUM_PASSPORT_VALIDITY_MONTHS = (\d+);", SCREENING_TS).group(1) == str(
        screening.MINIMUM_PASSPORT_VALIDITY_MONTHS
    )


def eligible(**fields) -> Candidate:
    """A candidate who passes, unsaved."""
    app = Application(job_id="cjob00000000", earliest_travel_date=NOW + timedelta(days=60))
    values = {
        "full_name": "Abebe Kebede",
        "nationality": "Ethiopian",
        "date_of_birth": datetime(1995, 5, 1),
        "passport_number": "EP1234567",
        "passport_expiry": datetime(2029, 1, 1),
        "phone": "+251911000000",
        "email": "abebe@test.invalid",
        "consent_given": True,
        "applications": [app],
    }
    return Candidate(**(values | fields))


def test_an_eligible_candidate_passes():
    assert evaluate_screening_gate(eligible(), NOW).passed


def test_every_failure_is_the_websites():
    seen = set(evaluate_screening_gate(Candidate(consent_given=False, applications=[]), NOW).failures)
    seen |= set(evaluate_screening_gate(eligible(applications=[Application()]), NOW).failures)
    seen |= set(evaluate_screening_gate(eligible(date_of_birth=datetime(2010, 1, 1), passport_expiry=datetime(2027, 1, 1)), NOW).failures)
    assert seen == website_messages()


def test_the_age_and_passport_edges():
    turns_18_tomorrow = datetime(2008, 10, 30)
    assert "Candidate is under the minimum eligible age of 18." in evaluate_screening_gate(eligible(date_of_birth=turns_18_tomorrow), NOW).failures
    assert evaluate_screening_gate(eligible(date_of_birth=datetime(2008, 10, 29)), NOW).passed
    # Calendar months, ignoring the day: April 2027 is six months away.
    assert evaluate_screening_gate(eligible(passport_expiry=datetime(2027, 4, 1)), NOW).passed
    assert not evaluate_screening_gate(eligible(passport_expiry=datetime(2027, 3, 31)), NOW).passed


def test_the_account_details_come_first():
    user = User(full_name="", email="acc@test.invalid", role=Role.candidate, phone=None)
    result = evaluate_screening_gate(eligible(user=user), NOW)
    # An empty account name isn't replaced by the form's (JS `??`); a
    # missing account phone is.
    assert result.failures == ["Full name is missing."]


def test_a_rejected_application_is_not_screened():
    rejected = Application(job_id="cjob00000000", earliest_travel_date=NOW, application_status=ApplicationStatus.rejected)
    assert "No Candidate Information Form submission on file." in evaluate_screening_gate(eligible(applications=[rejected]), NOW).failures


def test_an_older_application_needs_a_country_and_a_sector():
    older = Application(preferred_country_1_id="cc", preferred_sector_id="cs", earliest_travel_date=NOW)
    assert evaluate_screening_gate(eligible(applications=[older]), NOW).passed


# --- screen_and_invite -------------------------------------------------------


@pytest.fixture
def lead(db):
    region = Region(name=f"Scr region {secrets.token_hex(3)}")
    db.add(region)
    db.flush()
    country = Country(name=f"Scr land {secrets.token_hex(3)}", region_id=region.id)
    agent = ReferralAgent(full_name="Ref Agent", email=f"ra-{secrets.token_hex(3)}@test.invalid", phone="1", country="Kenya", referral_code=f"R{secrets.token_hex(4)}")
    job = Job(title="Care worker", country="Germany", city="Berlin", job_description="d", requirements="r")
    db.add_all([country, agent, job])
    db.flush()
    candidate = eligible(country_id=country.id, referral_agent_id=agent.id, email=f"lead-{secrets.token_hex(3)}@test.invalid", applications=[])
    db.add(candidate)
    db.flush()
    db.add(Application(candidate_id=candidate.id, job_id=job.id, earliest_travel_date=datetime(2027, 1, 1)))
    admin = User(full_name="Rules", email=f"rules-{secrets.token_hex(3)}@test.invalid", role=Role.admin)
    db.add(admin)
    db.flush()
    db.add(ReferralCommissionRule(country_id=country.id, milestone=ReferralMilestone.qualified, amount=40, currency="EUR", updated_by=admin.id))
    db.flush()
    db.expire_all()
    return {"candidate": candidate, "agent": agent}


def test_a_pass_screens_and_invites(db, lead):
    result = screen_and_invite(db, lead["candidate"].id)
    assert result.passed
    c = db.get(Candidate, lead["candidate"].id)
    assert (c.lifecycle_status, c.screening_result, c.return_reason, c.screening_evaluated_at is not None) == (
        CandidateLifecycleStatus.screened, True, None, True
    )
    assert (result.invite.candidate_id, result.invite.email, result.invite.full_name) == (c.id, c.email, "Abebe Kebede")
    assert (result.commission.agent_email, result.commission.amount, result.commission.milestone) == (lead["agent"].email, 40, ReferralMilestone.qualified)


def test_no_invite_for_a_candidate_with_an_account(db, lead):
    account = User(full_name="Has account", email=f"acct-{secrets.token_hex(3)}@test.invalid", role=Role.candidate, phone="1")
    db.add(account)
    db.flush()
    lead["candidate"].user_id = account.id
    db.flush()
    assert screen_and_invite(db, lead["candidate"].id).invite is None


def test_a_failure_is_recorded_and_nothing_moves(db, lead):
    lead["candidate"].consent_given = False
    db.flush()
    result = screen_and_invite(db, lead["candidate"].id)
    assert (result.passed, result.failures, result.invite, result.commission) == (False, ["Candidate consent has not been recorded."], None, None)
    c = db.get(Candidate, lead["candidate"].id)
    assert (c.lifecycle_status, c.screening_result) == (CandidateLifecycleStatus.identified, False)
    assert db.scalars(select(AuditLog.action).where(AuditLog.entity_id == c.id, AuditLog.action == "update")).all()


def test_an_unknown_candidate_fails():
    class NoRows:
        def scalar(self, _):
            return None

    assert screen_and_invite(NoRows(), "cnope").failures == ["Candidate not found."]
