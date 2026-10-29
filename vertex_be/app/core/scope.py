"""Who may see and change which candidate-pipeline records (SRS FR-1.2,
least privilege): the row-level scoping and single-record checks of
vertex/src/server/scope.ts, for the pipeline handover
(docs/architecture/pipeline-handover.md, step 6.1).

They mirror the website's rules role for role; tests/test_scope.py fails if
the two drift. Both fail closed: an unknown role, or a supervisor or
partner without an assignment, sees nothing.

- A candidate sees their own record; a recruiter the candidates they
  recruited; a Country Supervisor their country's; an In-House Supervisor
  their assigned countries'; a partner the candidates it bridged.
- Director, admin and the separation-of-duties roles (HR, operations,
  finance) are unrestricted, as decided on 2026-07-31. Q2 and Q3 (partner
  submissions and applications for HR, operations and reviewers) keep this
  global behaviour: owner's decision, 2026-10-29.
- Cases are reached through application -> candidate, so they use the
  candidate rules.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import ColumnElement, false, select, true
from sqlalchemy.orm import Session

from app.core.auth import AuthUser
from app.models.candidate import Application, Candidate
from app.models.cases import Case
from app.models.enums import Role
from app.models.identity import InhouseCountryAssignment, User
from app.models.partners import Partner, PartnerCandidate

# Unrestricted for candidates and cases.
UNRESTRICTED: frozenset[Role] = frozenset(
    {Role.director, Role.admin, Role.hr, Role.operations_team, Role.operations_director, Role.finance}
)
# May see a document on a partner's draft (no candidate yet): the owning
# partner, and the staff who enter drafts on a partner's behalf.
DRAFT_DOCUMENT_STAFF: frozenset[Role] = frozenset(
    {Role.admin, Role.director, Role.hr, Role.operations_team, Role.operations_director}
)


@dataclass(frozen=True)
class CandidateRef:
    """The fields a single-record check needs (canAccessCandidate's
    CandidateAccessCheck)."""

    user_id: str | None
    recruiter_id: str | None
    country_id: str | None
    partner_id: str | None = None

    @classmethod
    def of(cls, candidate: Candidate) -> CandidateRef:
        return cls(candidate.user_id, candidate.recruiter_id, candidate.country_id, candidate.partner_id)


def inhouse_country_ids(db: Session, user_id: str) -> list[str]:
    query = select(InhouseCountryAssignment.country_id).where(InhouseCountryAssignment.inhouse_supervisor_id == user_id)
    return list(db.scalars(query))


def _assigned_country(db: Session, user_id: str) -> str | None:
    return db.scalar(select(User.assigned_country_id).where(User.id == user_id))


def _partner_id(db: Session, user_id: str) -> str | None:
    return db.scalar(select(Partner.id).where(Partner.user_id == user_id))


def candidate_scope(db: Session, user: AuthUser) -> ColumnElement[bool]:
    """scopeCandidatesToRequester: a WHERE clause on Candidate."""
    match user.role:
        case Role.regional_recruiter:
            return Candidate.recruiter_id == user.user_id
        case Role.country_supervisor:
            country = _assigned_country(db, user.user_id)
            return Candidate.country_id == country if country else false()
        case Role.inhouse_supervisor:
            countries = inhouse_country_ids(db, user.user_id)
            return Candidate.country_id.in_(countries) if countries else false()
        case Role.partner:
            partner = _partner_id(db, user.user_id)
            return Candidate.partner_id == partner if partner else false()
        case Role.candidate:
            return Candidate.user_id == user.user_id
        case role if role in UNRESTRICTED:
            return true()
        case _:
            return false()


def can_access_candidate(db: Session, user: AuthUser, candidate: CandidateRef) -> bool:
    """canAccessCandidate: may this caller act on this one candidate?"""
    match user.role:
        case Role.candidate:
            return candidate.user_id == user.user_id
        case Role.regional_recruiter:
            return candidate.recruiter_id == user.user_id
        case Role.country_supervisor:
            return bool(candidate.country_id) and _assigned_country(db, user.user_id) == candidate.country_id
        case Role.inhouse_supervisor:
            return bool(candidate.country_id) and candidate.country_id in inhouse_country_ids(db, user.user_id)
        case Role.partner:
            return bool(candidate.partner_id) and _partner_id(db, user.user_id) == candidate.partner_id
        case role if role in UNRESTRICTED:
            return True
        case _:
            return False


def can_access_document(db: Session, user: AuthUser, candidate: CandidateRef | None, partner_candidate_id: str | None) -> bool:
    """canAccessDocument. A document on a partner's draft has no candidate
    yet, only partner_candidate_id."""
    if candidate is not None:
        return can_access_candidate(db, user, candidate)
    if not partner_candidate_id:
        return False
    if user.role in DRAFT_DOCUMENT_STAFF:
        return True
    if user.role is Role.partner:
        owner = db.scalar(
            select(Partner.user_id).join(PartnerCandidate, PartnerCandidate.partner_id == Partner.id).where(PartnerCandidate.id == partner_candidate_id)
        )
        return owner == user.user_id
    return False


def case_scope(db: Session, user: AuthUser) -> ColumnElement[bool]:
    """scopeCasesToRequester: a WHERE clause on Case, through application ->
    candidate."""
    return Case.application.has(Application.candidate.has(candidate_scope(db, user)))


def can_access_case(db: Session, user: AuthUser, candidate: CandidateRef) -> bool:
    """canAccessCase: a case is its candidate's."""
    return can_access_candidate(db, user, candidate)
