"""Who may do what, by role (SRS FR-1.1, FR-1.2): the role groups from
vertex/src/lib/rbac.ts, value for value, and require_role(), FastAPI's form
of requireRole() in vertex/src/lib/api-auth.ts. tests/test_rbac.py fails CI
if a group here drifts from rbac.ts.

Authentication comes first: require_role() depends on current_user, so a
missing, invalid or ended session is a 401 before any role is looked at,
and a live session with the wrong role is a 403. The role is the one in
the database, never the one in the token.

Only the API groups are ported. Portal paths, landing pages and the
internal-portal list in rbac.ts are page routing, which stays in Next.js.
Groups a single Next.js route defines for itself move with that route.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status

from app.core.auth import AuthUser, current_user
from app.core.logging import log_event
from app.models.enums import Role

# The three-tier operational hierarchy (SRS FR-1.3). marketing, partner and
# the hr/operations/finance directorates are deliberately not staff: see
# STAFF_ROLES in rbac.ts.
STAFF_ROLES: frozenset[Role] = frozenset(
    {Role.regional_recruiter, Role.country_supervisor, Role.inhouse_supervisor, Role.director, Role.admin}
)

# Case management split by directorate (Operational Workflow SOP,
# 2026-07-31); director and admin keep full override.
OPERATIONS_ROLES: frozenset[Role] = frozenset(
    {Role.operations_team, Role.operations_director, Role.director, Role.admin}
)
FINANCE_ROLES: frozenset[Role] = frozenset({Role.finance, Role.director, Role.admin})
HR_ROLES: frozenset[Role] = frozenset({Role.hr, Role.director, Role.admin})

# Referral agent system admin controls (2026-08-29): director/admin only.
REFERRAL_AGENT_MANAGER_ROLES: frozenset[Role] = frozenset({Role.director, Role.admin})


def is_staff_role(role: Role) -> bool:
    return role in STAFF_ROLES


def require_role(*roles: Role) -> Callable[..., AuthUser]:
    """A dependency that admits a live session whose role is one of roles:

        @router.get("/fee-policy")
        def read(user: Annotated[AuthUser, Depends(require_role(Role.director, Role.admin))]): ...

    or, for a group, require_role(*FINANCE_ROLES).
    """
    if not roles:
        raise ValueError("require_role() needs at least one role")
    allowed = frozenset(roles)

    def check_role(request: Request, user: Annotated[AuthUser, Depends(current_user)]) -> AuthUser:
        if user.role in allowed:
            return user
        # Same event and fields as requireRole()'s security.access_denied.
        log_event(
            logging.WARNING,
            "security.access_denied",
            actor_id=user.user_id,
            entity_type="Route",
            entity_id=request.url.path,
            reason="role",
            role=user.role.value,
            allowed=sorted(r.value for r in allowed),
            path=request.url.path,
        )
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden. Insufficient role.")

    return check_role
