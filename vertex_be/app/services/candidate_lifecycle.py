"""Who may move a candidate between lifecycle statuses (SRS FR-2.4, FR-2.5,
FR-2.7): canSetLifecycleStatus (vertex/src/server/services/
candidateLifecycle.ts), for the pipeline handover step 6.2.

The two must agree transition for transition: tests/test_candidate_lifecycle.py
checks this against the table the website's own test writes
(candidateLifecycle.matrix.json), and that every reason here is the
website's, word for word.

- "rejected" is a terminal side-branch, not a position on the track, so it
  is decided before any comparison by position.
- guided_to_apply and submitted are reached by the system (claiming the
  invite, uploading the required documents), not by staff.
- A recruiter takes a candidate up to "reported"; a supervisor picks up
  from there or returns one; only In-House (or the director) approves.
- HR manages self-submitted candidates end to end.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.models.enums import CandidateLifecycleStatus as Status
from app.models.enums import CandidateSource, Role

STATUS_ORDER: tuple[Status, ...] = (
    Status.identified,
    Status.screened,
    Status.guided_to_apply,
    Status.submitted,
    Status.reported,
    Status.verified,
    Status.approved,
)

RECRUITER_MAX_STATUS = Status.reported
SUPERVISOR_MIN_STATUS = Status.reported
IN_HOUSE_ROLES: frozenset[Role] = frozenset({Role.inhouse_supervisor, Role.director})


@dataclass(frozen=True)
class TransitionCheck:
    allowed: bool
    is_return: bool
    reason: str | None = None


def _no(reason: str, is_return: bool = False) -> TransitionCheck:
    return TransitionCheck(False, is_return, reason)


def _yes(is_return: bool) -> TransitionCheck:
    return TransitionCheck(True, is_return)


def can_set_lifecycle_status(role: Role, current: Status, target: Status, source: CandidateSource | None = None) -> TransitionCheck:
    if current is Status.rejected:
        return _no("Candidate has already been rejected — this is a terminal state.")

    if target is Status.rejected:
        if role not in (Role.hr, Role.admin):
            return _no("Only HR can reject a self-submitted candidate.")
        if source is not CandidateSource.self_registered:
            return _no("HR only manages self-submitted candidates.")
        if current not in (Status.identified, Status.submitted):
            return _no("A candidate can only be rejected before or after document submission.")
        return _yes(False)

    from_idx, to_idx = STATUS_ORDER.index(current), STATUS_ORDER.index(target)
    is_return = to_idx < from_idx

    if to_idx == from_idx:
        return _no("Candidate is already in that status.")

    if role is Role.admin:
        return _yes(is_return)

    if role is Role.hr:
        if source is not CandidateSource.self_registered:
            return _no("HR only manages self-submitted candidates.")
        if (current, target) in ((Status.identified, Status.screened), (Status.submitted, Status.approved)):
            return _yes(False)
        if (current, target) == (Status.submitted, Status.guided_to_apply):
            return _yes(True)  # request revision
        return _no(
            "HR can only approve a self-submitted candidate for account creation, approve it once submitted, or return it for revision."
        )

    if role is Role.regional_recruiter:
        if is_return:
            return _no("Recruiters cannot move a candidate backward — only a supervisor can return one.", is_return)
        if (current, target) == (Status.screened, Status.guided_to_apply):
            return _no(
                "Account creation happens automatically once the candidate claims their emailed invite link — there's nothing to manually advance here.",
                is_return,
            )
        if (current, target) == (Status.guided_to_apply, Status.submitted):
            return _no("Submission happens automatically once the candidate's required documents are uploaded.", is_return)
        if to_idx > STATUS_ORDER.index(RECRUITER_MAX_STATUS):
            return _no("Only a supervisor can verify or approve a candidate.", is_return)
        return _yes(is_return)

    if role in IN_HOUSE_ROLES:
        if not is_return and from_idx < STATUS_ORDER.index(SUPERVISOR_MIN_STATUS):
            return _no("A candidate must be reported by a recruiter before a supervisor can act on it.", is_return)
        return _yes(is_return)

    if role is Role.country_supervisor:
        if Status.approved in (current, target):
            return _no("Only In-House can approve a candidate, or reverse an approval.", is_return)
        if not is_return and from_idx < STATUS_ORDER.index(SUPERVISOR_MIN_STATUS):
            return _no("A candidate must be reported by a recruiter before a supervisor can act on it.", is_return)
        return _yes(is_return)

    return _no("This role cannot update candidate status.", is_return)
