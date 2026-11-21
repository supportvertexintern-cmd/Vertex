"""Role management (2026-11-21): the admin assigns permissions to roles.

- GET /admin/roles: every permission (app/core/permissions.py) and, for
  each internal role, the ones it holds. Admin is listed holding all of
  them, and can't be changed.
- PUT /admin/roles/{role}/permissions: sets what a role holds. Only an
  internal role other than admin; external roles (candidate, partner,
  referral agent) are refused whatever is sent.

Admin only. Every tick and untick is a RolePermission row on the audit
trail, and giving a role more raises the privilege_granted alert, as
promoting a user does.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.deps import DbSession
from app.core.api import ApiError, Data
from app.core.audit import AuditedDb
from app.core.auth import AuthUser
from app.core.permissions import ASSIGNABLE_ROLES, EXTERNAL_ROLES, PERMISSIONS, Permission, role_permissions
from app.core.rbac import require_role
from app.models.enums import Role
from app.models.permissions import RolePermission
from app.services import security_monitor

router = APIRouter()

Admin = Annotated[AuthUser, Depends(require_role(Role.admin))]


class PermissionOut(BaseModel):
    key: Permission
    group: str
    label: str
    description: str


class RoleOut(BaseModel):
    role: Role
    editable: bool  # false for admin, which holds everything
    permissions: list[Permission]


class RolesOut(BaseModel):
    permissions: list[PermissionOut]
    roles: list[RoleOut]


class PermissionsIn(BaseModel):
    permissions: list[Permission]


def _role(db: DbSession, role: Role) -> RoleOut:
    held = role_permissions(db, role)
    return RoleOut(role=role, editable=role is not Role.admin, permissions=[p for p in Permission if p in held])


@router.get("/admin/roles")
def list_roles(db: DbSession, _admin: Admin) -> Data[RolesOut]:
    """The grid: permissions in their order, and the internal roles with admin first."""
    permissions = [PermissionOut(key=s.permission, group=s.group, label=s.label, description=s.description) for s in PERMISSIONS.values()]
    roles = [_role(db, Role.admin), *(_role(db, r) for r in ASSIGNABLE_ROLES)]
    return Data(data=RolesOut(permissions=permissions, roles=roles))


@router.put("/admin/roles/{role}/permissions")
def set_permissions(role: Role, body: PermissionsIn, db: AuditedDb, admin: Admin) -> Data[RoleOut]:
    """Sets exactly what a role holds: ticks what's new, unticks what's left out."""
    if role is Role.admin:
        raise ApiError(400, "role_not_editable", "Admin always holds every permission.")
    if role in EXTERNAL_ROLES:
        raise ApiError(400, "role_not_assignable", "Only internal roles can be given permissions.")
    wanted = {p.value for p in body.permissions}
    try:
        granted = _apply(db, role, wanted, admin.user_id)
    except IntegrityError:
        db.rollback()  # the same tick saved meanwhile: apply again over it
        granted = _apply(db, role, wanted, admin.user_id)
    if granted:
        security_monitor.on_permissions_granted(admin.user_id, role.value, granted)
    return Data(data=_role(db, role))


def _apply(db: AuditedDb, role: Role, wanted: set[str], admin_id: str) -> list[str]:
    rows = {r.permission: r for r in db.scalars(select(RolePermission).where(RolePermission.role == role).with_for_update())}
    for permission, row in rows.items():
        if permission not in wanted:
            db.delete(row)
    granted = [p.value for p in Permission if p.value in wanted and p.value not in rows]
    for permission in granted:
        db.add(RolePermission(role=role, permission=permission, granted_by=admin_id))
    db.commit()
    return granted
