"""Exception escalation (Supervisory Reporting Framework §6): a port of
vertex/src/server/services/exceptionWorkflow.ts and the raise levels in
/api/exceptions, for the pipeline handover step 6.5.

An exception climbs Regional Recruiter -> Country Supervisor -> In-House
Supervisor -> Management. Each role may act from its own tier up; admin on
any. Whether the exception is in the actor's country is a separate check
(app/api/v1/exceptions.py).
"""

from __future__ import annotations

from app.models.enums import EscalationLevel, Role

ESCALATION_LEVEL_ORDER: tuple[EscalationLevel, ...] = tuple(EscalationLevel)

# The lowest tier each role is trusted to act on (escalate or decide).
MIN_ACTIONABLE_LEVEL_BY_ROLE: dict[Role, EscalationLevel] = {
    Role.country_supervisor: EscalationLevel.country,
    Role.inhouse_supervisor: EscalationLevel.inhouse,
    Role.director: EscalationLevel.management,
    Role.admin: EscalationLevel.regional,
}

# Where a fresh exception starts, by its raiser's role: the line begins
# with the recruiter; the central directorates sit with management.
RAISE_LEVEL_BY_ROLE: dict[Role, EscalationLevel] = {
    Role.regional_recruiter: EscalationLevel.regional,
    Role.country_supervisor: EscalationLevel.country,
    Role.inhouse_supervisor: EscalationLevel.inhouse,
    Role.director: EscalationLevel.management,
    Role.admin: EscalationLevel.management,
    Role.marketing: EscalationLevel.regional,
    Role.partner: EscalationLevel.regional,
    Role.referral_agent: EscalationLevel.regional,
    Role.candidate: EscalationLevel.regional,
    Role.hr: EscalationLevel.management,
    Role.operations_team: EscalationLevel.management,
    Role.operations_director: EscalationLevel.management,
    Role.finance: EscalationLevel.management,
}


def next_escalation_level(current: EscalationLevel) -> EscalationLevel:
    """One tier up; management stays management."""
    idx = ESCALATION_LEVEL_ORDER.index(current)
    return ESCALATION_LEVEL_ORDER[min(idx + 1, len(ESCALATION_LEVEL_ORDER) - 1)]


def role_can_act_on_level(role: Role, level: EscalationLevel) -> bool:
    if role is Role.admin:
        return True
    minimum = MIN_ACTIONABLE_LEVEL_BY_ROLE.get(role)
    if minimum is None:
        return False
    return ESCALATION_LEVEL_ORDER.index(level) >= ESCALATION_LEVEL_ORDER.index(minimum)
