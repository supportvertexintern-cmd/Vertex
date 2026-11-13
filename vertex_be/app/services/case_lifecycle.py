"""A case's place in the mobility lifecycle (SRS FR-4.1, FR-4.2): a port of
vertex/src/server/services/caseLifecycle.ts for the pipeline handover
step 6.5.

A case opens when a candidate is approved by In-House, one per application,
at the first of the Operational Workflow SOP's 11 stages. Operations own the
stages; director and admin keep override.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.rbac import OPERATIONS_ROLES
from app.models.cases import Case, CaseStageEvent
from app.models.enums import CaseStage, Role

# CASE_STAGE_ORDER: the SOP's journey (tests compare it with the website's).
CASE_STAGE_ORDER: tuple[CaseStage, ...] = tuple(CaseStage)


@dataclass(frozen=True)
class CaseTransitionCheck:
    allowed: bool
    is_return: bool
    reason: str | None = None
    # The current stage again: an edit of its date and notes, not a move.
    is_update: bool = False


def can_set_case_stage(role: Role, current: CaseStage, target: CaseStage) -> CaseTransitionCheck:
    """canSetCaseStage: Operations pick any stage at any time (2026-10-26),
    the current one included, which edits its date and notes in place."""
    from_idx, to_idx = CASE_STAGE_ORDER.index(current), CASE_STAGE_ORDER.index(target)
    is_return, is_update = to_idx < from_idx, to_idx == from_idx
    if role in OPERATIONS_ROLES:
        return CaseTransitionCheck(True, is_return, is_update=is_update)
    return CaseTransitionCheck(False, is_return, "This role cannot update case status.", is_update)


def open_case(db: Session, application_id: str) -> Case:
    """createCaseForApprovedApplication: the application's case, opened at
    the first stage if it hasn't one yet. Writes in the caller's session
    (so its audit actor), uncommitted."""
    existing = db.scalar(select(Case).where(Case.application_id == application_id))
    if existing is not None:
        return existing
    case = Case(application_id=application_id)
    db.add(case)
    db.flush()
    db.add(CaseStageEvent(case_id=case.id, stage=CaseStage.registration_document_submission))
    db.flush()
    return case
