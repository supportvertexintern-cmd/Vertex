"""The lifecycle rules (step 6.2) match canSetLifecycleStatus
(vertex/src/server/services/candidateLifecycle.ts) move for move, through
the table the website's own test checks its rules against."""

import json
import re

from app.core.config import BASE_DIR
from app.models.enums import CandidateLifecycleStatus, CandidateSource, Role
from app.services import candidate_lifecycle
from app.services.candidate_lifecycle import STATUS_ORDER, can_set_lifecycle_status

SERVICES = BASE_DIR.parent / "vertex" / "src" / "server" / "services"
LIFECYCLE_TS = (SERVICES / "candidateLifecycle.ts").read_text(encoding="utf-8")


def allowed_moves() -> list[str]:
    moves = []
    for role in Role:
        for current in CandidateLifecycleStatus:
            for target in CandidateLifecycleStatus:
                for source in CandidateSource:
                    check = can_set_lifecycle_status(role, current, target, source)
                    if check.allowed:
                        moves.append(f"{role.value} {current.value}>{target.value} {source.value}{' return' if check.is_return else ''}")
    return sorted(moves)


def test_every_move_matches_the_website():
    table = json.loads((SERVICES / "candidateLifecycle.matrix.json").read_text(encoding="utf-8"))
    assert allowed_moves() == table


def test_the_status_order_matches_the_website():
    order = re.search(r"export const STATUS_ORDER[^=]*= \[(.*?)\];", LIFECYCLE_TS, re.S).group(1)
    assert re.findall(r'"(\w+)"', order) == [s.value for s in STATUS_ORDER]


def test_every_refusal_says_what_the_website_says():
    """The reasons reach the user as the error message."""
    source = (BASE_DIR / "app" / "services" / "candidate_lifecycle.py").read_text(encoding="utf-8")
    reasons = re.findall(r'_no\(\s*"([^"]+)"', source)
    assert len(reasons) >= 12
    for reason in reasons:
        assert f'"{reason}"' in LIFECYCLE_TS, reason


def test_a_refusal_always_has_a_reason():
    for role in Role:
        for current in CandidateLifecycleStatus:
            for target in CandidateLifecycleStatus:
                check = can_set_lifecycle_status(role, current, target, CandidateSource.self_registered)
                assert check.allowed or check.reason, (role, current, target)
    assert candidate_lifecycle.IN_HOUSE_ROLES == {Role.inhouse_supervisor, Role.director}
