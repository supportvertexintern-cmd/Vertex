"""Permissions the admin assigns to roles (role management, 2026-11-21).

require_role() (app/core/rbac.py) fixes in code which roles may use a
route. For the areas moved here, the admin decides instead, on the Roles &
permissions page: each permission below is held by the roles ticked for it
(app/models/permissions.py stores the ticks). Rules:

- The list is code. The admin ticks roles; nobody can invent a permission,
  because each one is enforced by the routes that name it.
- Admin holds every permission, always: it isn't stored and can't be
  unticked, so the admin can't be locked out.
- Only internal roles can be given one: never candidate, partner or
  referral agent (EXTERNAL_ROLES), whatever the request says.
- Each permission's DEFAULT_ROLES are who could do it before it moved here;
  the migration that adds a permission grants them, so nothing changes on
  deploy.
- The role is the one in the database (current_user), and the ticks are
  read on every request, so a change applies at once, without signing in
  again.

Areas not moved here keep their require_role() checks unchanged.
"""

from __future__ import annotations

import enum
from collections.abc import Callable
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import record_security_event
from app.core.auth import AuthUser, current_user
from app.core.rbac import INTERNAL_ROLES
from app.db.session import get_db
from app.models.enums import Role


class Permission(str, enum.Enum):
    landing_edit = "landing.edit"
    landing_publish = "landing.publish"


@dataclass(frozen=True)
class PermissionSpec:
    permission: Permission
    group: str  # how the admin page groups them
    label: str
    description: str
    default_roles: frozenset[Role]


PERMISSIONS: dict[Permission, PermissionSpec] = {
    s.permission: s
    for s in (
        PermissionSpec(
            Permission.landing_edit,
            "Landing pages",
            "Edit drafts",
            "Save, preview and discard drafts of the website's and the app's landing pages, and restore an earlier version into the draft.",
            frozenset({Role.marketing}),
        ),
        PermissionSpec(
            Permission.landing_publish,
            "Landing pages",
            "Publish",
            "Make a draft what visitors see.",
            frozenset({Role.marketing}),
        ),
    )
}

# Accounts outside Vertex: never given a permission (every role not in
# INTERNAL_ROLES, which matches rbac.ts).
EXTERNAL_ROLES: frozenset[Role] = frozenset(Role) - INTERNAL_ROLES
# The roles the admin can tick (admin itself holds everything).
ASSIGNABLE_ROLES: tuple[Role, ...] = tuple(r for r in Role if r in INTERNAL_ROLES and r is not Role.admin)


def role_permissions(db: Session, role: Role) -> frozenset[Permission]:
    """What a role holds now: every permission for admin, none for an
    external role, otherwise the ticks."""
    if role is Role.admin:
        return frozenset(Permission)
    if role in EXTERNAL_ROLES:
        return frozenset()
    from app.models.permissions import RolePermission  # the models import app.core

    known = {p.value for p in Permission}
    stored = db.scalars(select(RolePermission.permission).where(RolePermission.role == role))
    return frozenset(Permission(p) for p in stored if p in known)


def has_permission(db: Session, user: AuthUser | None, *permissions: Permission) -> bool:
    """Whether user's role holds any of permissions (never for no user)."""
    return user is not None and not role_permissions(db, user.role).isdisjoint(permissions)


def require_permission(*permissions: Permission) -> Callable[..., AuthUser]:
    """A dependency that admits a live session whose role holds any of
    permissions, as require_role() does for a fixed list: 401 without a
    session, 403 (and an audit row) without one of them."""
    if not permissions:
        raise ValueError("require_permission() needs at least one permission")

    def check_permission(
        request: Request,
        user: Annotated[AuthUser, Depends(current_user)],
        db: Annotated[Session, Depends(get_db)],
    ) -> AuthUser:
        if has_permission(db, user, *permissions):
            return user
        record_security_event(
            "access_denied",
            actor_id=user.user_id,
            entity_type="Route",
            entity_id=request.url.path,
            detail={
                "reason": "permission",
                "role": user.role.value,
                "permissions": sorted(p.value for p in permissions),
                "ip": request.client.host if request.client else None,
                "path": request.url.path,
            },
        )
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden. Your role doesn't have this permission.")

    return check_permission
