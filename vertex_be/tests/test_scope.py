"""The pipeline's access rules (step 6.1) match vertex/src/server/scope.ts,
role for role, and fail closed."""

import re
import secrets

import pytest
from sqlalchemy import select

from app.core.auth import AuthUser
from app.core.config import BASE_DIR
from app.core.scope import (
    DRAFT_DOCUMENT_STAFF,
    UNRESTRICTED,
    CandidateRef,
    can_access_candidate,
    can_access_case,
    can_access_document,
    candidate_scope,
    case_scope,
)
from app.models.candidate import Application, Candidate
from app.models.cases import Case
from app.models.enums import PartnerType, Role
from app.models.identity import Country, InhouseCountryAssignment, Region, User
from app.models.partners import Partner, PartnerCandidate

SCOPE_TS = (BASE_DIR.parent / "vertex" / "src" / "server" / "scope.ts").read_text(encoding="utf-8")


def _function(name: str) -> str:
    start = SCOPE_TS.index(f"export async function {name}(")
    end = SCOPE_TS.find("\nexport ", start + 1)
    return SCOPE_TS[start : end if end != -1 else None]


def _roles_returning(name: str, returned: str) -> set[str]:
    """The roles whose case group in the website's function returns `returned`."""
    body = _function(name)
    groups = re.findall(r'((?:\s*case "\w+":)+)\s*return ' + re.escape(returned) + ";", body)
    return {role for group in groups for role in re.findall(r'case "(\w+)"', group)}


def test_the_unrestricted_roles_match_the_website():
    names = {r.value for r in UNRESTRICTED}
    assert _roles_returning("scopeCandidatesToRequester", "{}") == names
    assert _roles_returning("canAccessCandidate", "true") == names
    assert _roles_returning("canAccessDocument", "true") == {r.value for r in DRAFT_DOCUMENT_STAFF}


def test_every_role_the_website_handles_is_handled_here():
    handled = set(re.findall(r'case "(\w+)"', _function("scopeCandidatesToRequester")))
    # Marketing and referral agents fall to the default on both sides: nothing.
    assert handled == {r.value for r in Role} - {"marketing", "referral_agent"}


def test_cases_use_the_candidate_rules_on_both_sides():
    assert "scopeCandidatesToRequester(user)" in _function("scopeCasesToRequester")
    assert "return canAccessCandidate(user, candidate)" in _function("canAccessCase")


# --- behaviour ---------------------------------------------------------------


def user(db, role: Role, **fields) -> User:
    u = User(full_name=f"{role.value} {secrets.token_hex(2)}", email=f"scope-{secrets.token_hex(4)}@test.invalid", role=role, **fields)
    db.add(u)
    db.flush()
    return u


def caller(u: User) -> AuthUser:
    return AuthUser(user_id=u.id, email=u.email, role=u.role, sid="s", ver=u.token_version)


@pytest.fixture
def world(db):
    region = Region(name=f"Scope region {secrets.token_hex(3)}")
    db.add(region)
    db.flush()
    home = Country(name=f"Scope home {secrets.token_hex(3)}", region_id=region.id)
    away = Country(name=f"Scope away {secrets.token_hex(3)}", region_id=region.id)
    db.add_all([home, away])
    db.flush()
    recruiter = user(db, Role.regional_recruiter, assigned_country_id=home.id)
    owner = user(db, Role.candidate)
    partner_user = user(db, Role.partner)
    partner = Partner(name="Scope partner", partner_type=PartnerType.other, country_of_operation="Kenya", contact_name="P", contact_email=f"p-{secrets.token_hex(3)}@test.invalid", contact_phone="1", user_id=partner_user.id)
    db.add(partner)
    db.flush()
    mine = Candidate(full_name="Home candidate", user_id=owner.id, recruiter_id=recruiter.id, country_id=home.id, partner_id=partner.id)
    other = Candidate(full_name="Away candidate", country_id=away.id)
    db.add_all([mine, other])
    db.flush()
    return {"home": home, "away": away, "recruiter": recruiter, "owner": owner, "partner_user": partner_user, "partner": partner, "mine": mine, "other": other}


def visible(db, who: User, *candidates: Candidate) -> set[str]:
    ids = [c.id for c in candidates]
    return set(db.scalars(select(Candidate.id).where(Candidate.id.in_(ids), candidate_scope(db, caller(who)))))


def test_each_role_sees_its_own_candidates(db, world):
    mine, other = world["mine"], world["other"]
    assert visible(db, world["recruiter"], mine, other) == {mine.id}
    assert visible(db, world["owner"], mine, other) == {mine.id}
    assert visible(db, world["partner_user"], mine, other) == {mine.id}
    assert visible(db, user(db, Role.country_supervisor, assigned_country_id=world["home"].id), mine, other) == {mine.id}
    inhouse = user(db, Role.inhouse_supervisor)
    db.add(InhouseCountryAssignment(inhouse_supervisor_id=inhouse.id, country_id=world["away"].id))
    db.flush()
    assert visible(db, inhouse, mine, other) == {other.id}
    for role in UNRESTRICTED:
        assert visible(db, user(db, role), mine, other) == {mine.id, other.id}, role


@pytest.mark.parametrize("role", [Role.country_supervisor, Role.inhouse_supervisor, Role.partner, Role.marketing, Role.referral_agent])
def test_an_unassigned_or_unrelated_caller_sees_nothing(db, world, role):
    nobody = user(db, role)
    assert visible(db, nobody, world["mine"], world["other"]) == set()
    assert not can_access_candidate(db, caller(nobody), CandidateRef.of(world["mine"]))


def test_single_record_checks_match_the_scope(db, world):
    refs = {"mine": CandidateRef.of(world["mine"]), "other": CandidateRef.of(world["other"])}
    for who in (world["recruiter"], world["owner"], world["partner_user"], user(db, Role.country_supervisor, assigned_country_id=world["home"].id), user(db, Role.hr)):
        seen = visible(db, who, world["mine"], world["other"])
        allowed = {name_id for name, name_id in (("mine", world["mine"].id), ("other", world["other"].id)) if can_access_candidate(db, caller(who), refs[name])}
        assert allowed == seen, who.role
        assert can_access_case(db, caller(who), refs["mine"]) == (world["mine"].id in seen)


def test_a_country_less_candidate_is_refused_to_country_roles(db, world):
    floating = CandidateRef(user_id=None, recruiter_id=None, country_id=None)
    assert not can_access_candidate(db, caller(user(db, Role.country_supervisor, assigned_country_id=world["home"].id)), floating)


def test_case_scope_goes_through_the_candidate(db, world):
    app_mine = Application(candidate_id=world["mine"].id)
    app_other = Application(candidate_id=world["other"].id)
    db.add_all([app_mine, app_other])
    db.flush()
    case_mine, case_other = Case(application_id=app_mine.id), Case(application_id=app_other.id)
    db.add_all([case_mine, case_other])
    db.flush()
    seen = set(db.scalars(select(Case.id).where(Case.id.in_([case_mine.id, case_other.id]), case_scope(db, caller(world["recruiter"])))))
    assert seen == {case_mine.id}


def test_documents_on_a_partner_draft(db, world):
    draft = PartnerCandidate(partner_id=world["partner"].id, full_name="Draft person")
    db.add(draft)
    db.flush()
    assert can_access_document(db, caller(world["partner_user"]), None, draft.id)
    other_partner_user = user(db, Role.partner)
    assert not can_access_document(db, caller(other_partner_user), None, draft.id)
    assert can_access_document(db, caller(user(db, Role.hr)), None, draft.id)
    assert not can_access_document(db, caller(user(db, Role.finance)), None, draft.id)  # finance isn't draft staff
    assert not can_access_document(db, caller(user(db, Role.admin)), None, None)
    assert can_access_document(db, caller(world["owner"]), CandidateRef.of(world["mine"]), None)
