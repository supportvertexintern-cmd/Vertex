"""The admin's user pages, owned by FastAPI from users and sessions step 8.3
(docs/architecture/users-handover.md): create a staff account (with its
setup email), change a user's role, supervisor and countries, delete one,
and reset one's password to a temporary one. They replace POST
/api/admin/users, PATCH and DELETE /api/admin/users/[id] and POST
/api/admin/users/[id]/reset-password, which pass requests on. The
directory (GET) is in payment_reads.py since reads handover R6.

They answer as those routes did: admins only (a test fails if the lists
drift), the same messages, status codes and JSON. Every change is on the
audit trail. When an account becomes an admin the answer says so in
`privilege_granted`, and the privilege_granted alert is raised here (the
website raised it until reads handover R7a).

What changes (security review #11, #12):
  - Nobody changes their own role, and the last admin can't be demoted or
    deleted. The admin rows are locked while that's checked, so two admins
    demoting each other at once can't leave none.
  - Unknown fields are ignored.

Deactivation (admin monitoring, phase 1, 2026-11-07): an admin deactivates
any login instead of deleting it, with a reason. Its sessions end at once,
and no sign-in, refresh, setup or reset link works until an admin
reactivates it, with a reason. Reactivating leaves activated_at and
welcomed_at as they were. Nobody deactivates themselves, or the last active
admin; a deactivated admin doesn't count as one.
"""

from __future__ import annotations

import secrets
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request, status
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints
from pydantic_core import PydanticCustomError
from sqlalchemy import exists, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app.api.notices import AccountSetupEmail, Notice, Notifying
from app.api.v1.sessions import EMAIL_LIMITED, account_email_allowed, record_account_email, security_event
from app.services.emails import deliver
from app.core.api import ApiError, Data, Email, UtcDateTime
from app.core.audit import AuditedDb
from app.core.auth import AuthUser
from app.core.clock import utc_now_ms
from app.core.rbac import is_staff_role, require_role
from app.core.tokens import sign_account_setup_token
from app.models.enums import Role
from app.models.identity import Country, InhouseCountryAssignment, User
from app.services import security_monitor
from app.services.sessions import hash_password, revoke_all_for_user

router = APIRouter()

Admin = Annotated[AuthUser, Depends(require_role(Role.admin))]  # requireAdmin()

CUID = r"^c[^\s-]{8,}$"  # zod's .cuid()
Cuid = Annotated[str, StringConstraints(pattern=CUID)]

# STAFF_ROLES in lib/validations.ts: the roles an admin may give.
ASSIGNABLE_ROLES = (
    Role.regional_recruiter, Role.country_supervisor, Role.inhouse_supervisor, Role.director, Role.marketing,
    Role.hr, Role.operations_team, Role.operations_director, Role.finance, Role.admin,
)


def _assignable(value: Role) -> Role:
    if value not in ASSIGNABLE_ROLES:
        raise PydanticCustomError("value_error", "Invalid option")
    return value


StaffRole = Annotated[Role, AfterValidator(_assignable)]


# --- input --------------------------------------------------------------------


class CreateIn(BaseModel):
    full_name: Annotated[str, StringConstraints(min_length=2, max_length=100)]
    email: Email
    role: StaffRole
    supervisor_id: Cuid | None = None
    assigned_country_id: Cuid | None = None
    assigned_country_ids: list[Cuid] | None = None


class UpdateIn(BaseModel):
    role: StaffRole | None = None
    supervisor_id: Cuid | None = None
    assigned_country_id: Cuid | None = None
    assigned_country_ids: list[Cuid] | None = None


class ReasonIn(BaseModel):
    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=500)]


# --- output -------------------------------------------------------------------


class Named(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    full_name: str


class CountryRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str


class StaffRow(BaseModel):
    id: str
    full_name: str
    email: str
    role: Role
    supervisor_id: str | None
    supervisor: Named | None
    assigned_country_id: str | None
    assigned_country: CountryRef | None
    assigned_countries: list[CountryRef]


class Granted(BaseModel):
    """For the website's onPrivilegeGranted(): from None when created."""

    model_config = ConfigDict(populate_by_name=True)

    from_: Role | None = Field(alias="from", serialization_alias="from")
    to: Role


class Written(Notifying[StaffRow]):
    privilege_granted: Granted | None = None


class Removed(BaseModel):
    id: str


class TemporaryPassword(Data[Removed]):
    temporaryPassword: str  # noqa: N815 (the website's field name)


class AccountState(BaseModel):
    id: str
    deactivated_at: UtcDateTime | None
    deactivated_by: str | None
    deactivation_reason: str | None
    # Sessions the deactivation ended.
    ended: int = 0


class SetupSent(BaseModel):
    email: str


# --- helpers ------------------------------------------------------------------


def _row(db, user: User) -> dict[str, Any]:
    countries = db.scalars(
        select(Country).join(InhouseCountryAssignment, InhouseCountryAssignment.country_id == Country.id)
        .where(InhouseCountryAssignment.inhouse_supervisor_id == user.id)
    ).all()
    return {
        "id": user.id, "full_name": user.full_name, "email": user.email, "role": user.role,
        "supervisor_id": user.supervisor_id, "supervisor": user.supervisor,
        "assigned_country_id": user.assigned_country_id, "assigned_country": user.assigned_country,
        "assigned_countries": countries,
    }


def _check_supervisor(db, supervisor_id: str | None) -> None:
    if supervisor_id:
        supervisor = db.get(User, supervisor_id)
        if supervisor is None or not is_staff_role(supervisor.role):
            raise ApiError(422, "invalid_supervisor", "Supervisor must be an existing staff member.")


def _check_countries(db, country_id: str | None, country_ids: list[str] | None) -> None:
    if country_id and db.get(Country, country_id) is None:
        raise ApiError(404, "not_found", "Country not found.")
    if country_ids:
        found = db.scalar(select(func.count()).select_from(Country).where(Country.id.in_(country_ids)))
        if found != len(country_ids):
            raise ApiError(404, "not_found", "One or more countries not found.")


def keep_an_admin(db, actor_id: str, target_id: str) -> None:
    """Before an admin is demoted or deleted: locks every admin row, in id
    order, so two such requests wait for each other and the second sees the
    first's change. Refuses if the target is the last admin, or if the
    caller stopped being one meanwhile."""
    active = User.deactivated_at.is_(None)  # a deactivated admin can't act as one
    admins = set(db.scalars(select(User.id).where(User.role == Role.admin, active).order_by(User.id).with_for_update()))
    if not admins - {target_id}:
        raise ApiError(409, "last_admin", "There must always be at least one admin.")
    if actor_id not in admins:
        raise ApiError(403, "forbidden", "Forbidden")


def _granted(admin: AuthUser, user_id: str, was: Role | None, now: Role) -> dict[str, Any] | None:
    """{from, to} when the account just became an admin, alerted."""
    if now is not Role.admin or was is Role.admin:
        return None
    security_monitor.on_privilege_granted(admin.user_id, user_id, was.value if was else None, now.value)
    return {"from": was, "to": now}


def _load(db, user_id: str) -> User:
    user = db.scalar(
        select(User).where(User.id == user_id).options(selectinload(User.supervisor), selectinload(User.assigned_country))
        .execution_options(populate_existing=True)
    )
    if user is None:
        raise ApiError(404, "not_found", "User not found.")
    return user


# --- routes -------------------------------------------------------------------


@router.post("/users", status_code=status.HTTP_201_CREATED, response_model=Written)
def create_user(body: CreateIn, admin: Admin, request: Request, db: AuditedDb):
    """A new staff account with no password: the setup email lets them set
    their own."""
    if db.scalar(select(exists().where(User.email == body.email))):
        raise ApiError(409, "duplicate", "A user with this email already exists.")
    _check_supervisor(db, body.supervisor_id)
    _check_countries(db, body.assigned_country_id, body.assigned_country_ids)

    user = User(
        full_name=body.full_name, email=body.email, role=body.role, email_verified=False,
        supervisor_id=body.supervisor_id, assigned_country_id=body.assigned_country_id, created_by=admin.user_id,
    )
    if body.role is Role.inhouse_supervisor and body.assigned_country_ids:
        user.inhouse_country_assignments = [InhouseCountryAssignment(country_id=c) for c in body.assigned_country_ids]
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()  # the address was taken meanwhile
        raise ApiError(409, "duplicate", "A user with this email already exists.") from None

    user = _load(db, user.id)
    notify: list[Notice] = [AccountSetupEmail(email=user.email, full_name=user.full_name, token=sign_account_setup_token(user.id))]
    record_account_email(request, user, "account_setup", actor_id=admin.user_id)
    return {"data": _row(db, user), "notify": deliver(db, notify), "privilege_granted": _granted(admin, user.id, None, user.role)}


@router.patch("/users/{user_id}", response_model=Written)
def update_user(user_id: str, body: UpdateIn, admin: Admin, db: AuditedDb):
    """Role, supervisor and countries (SRS FR-1.1, FR-1.3, FR-1.4). A field
    left out is left alone; assigned_country_ids replaces the whole list."""
    sent = body.model_fields_set
    if "role" in sent and body.role is None:
        raise ApiError(422, "validation_error", "Validation failed", {"role": ["Invalid option"]})
    if "assigned_country_ids" in sent and body.assigned_country_ids is None:
        raise ApiError(422, "validation_error", "Validation failed", {"assigned_country_ids": ["Invalid input"]})

    user = db.get(User, user_id)
    if user is None:
        raise ApiError(404, "not_found", "User not found.")
    if body.supervisor_id:
        if body.supervisor_id == user_id:
            raise ApiError(422, "invalid_supervisor", "A user cannot supervise themselves.")
        _check_supervisor(db, body.supervisor_id)
    _check_countries(db, body.assigned_country_id, body.assigned_country_ids)

    was = user.role
    if body.role is not None and body.role is not was:
        if user_id == admin.user_id:
            raise ApiError(400, "self_role_change", "You can't change your own role.")
        if was is Role.admin:
            keep_an_admin(db, admin.user_id, user_id)
            db.refresh(user)  # as the lock left it
            was = user.role
        user.role = body.role
    if "supervisor_id" in sent:
        user.supervisor_id = body.supervisor_id
    if "assigned_country_id" in sent:
        user.assigned_country_id = body.assigned_country_id
    if body.assigned_country_ids is not None:
        # Deleted and flushed first: the unit of work inserts before it
        # deletes, and the pairs are unique.
        for old in db.scalars(select(InhouseCountryAssignment).where(InhouseCountryAssignment.inhouse_supervisor_id == user_id)):
            db.delete(old)
        db.flush()
        db.add_all(InhouseCountryAssignment(inhouse_supervisor_id=user_id, country_id=c) for c in body.assigned_country_ids)
    db.commit()

    user = _load(db, user_id)
    return {"data": _row(db, user), "privilege_granted": _granted(admin, user.id, was, user.role)}


@router.delete("/users/{user_id}", response_model=Data[Removed])
def delete_user(user_id: str, admin: Admin, db: AuditedDb):
    """Removes an account; its dependants follow the foreign keys, as with
    Prisma. Nobody removes themselves, or the last admin."""
    if user_id == admin.user_id:
        raise ApiError(400, "self_delete", "You can't remove your own account.")
    user = db.get(User, user_id)
    if user is None:
        raise ApiError(404, "not_found", "User not found.")
    if user.role is Role.admin:
        keep_an_admin(db, admin.user_id, user_id)
    db.delete(user)
    db.commit()
    return {"data": {"id": user_id}}


@router.post("/users/{user_id}/reset-password", response_model=TemporaryPassword)
def reset_password(user_id: str, admin: Admin, db: AuditedDb):
    """A temporary password, shown to the admin once and never stored or
    logged in plain text. The user's sessions end (token_version trigger)."""
    user = db.get(User, user_id)
    if user is None:
        raise ApiError(404, "not_found", "User not found.")
    if user.deactivated_at is not None:
        raise _deactivated()
    temporary = secrets.token_urlsafe(12)  # generateTemporaryPassword(): 12 random bytes, base64url
    user.password_hash = hash_password(temporary)
    db.commit()
    return {"data": {"id": user_id}, "temporaryPassword": temporary}


# --- deactivation (admin monitoring, phase 1) ------------------------------------


def _deactivated() -> ApiError:
    return ApiError(409, "account_deactivated", "This account is deactivated — reactivate it first.")


def _state(user: User, ended: int = 0) -> dict[str, Any]:
    return {
        "id": user.id, "deactivated_at": user.deactivated_at, "deactivated_by": user.deactivated_by,
        "deactivation_reason": user.deactivation_reason, "ended": ended,
    }


@router.post("/users/{user_id}/deactivate", response_model=Data[AccountState])
def deactivate_user(user_id: str, body: ReasonIn, admin: Admin, request: Request, db: AuditedDb):
    """Blocks the account and ends every session in the same commit, so its
    next request is refused. An admin's row is locked with every other
    admin's (keep_an_admin), anyone else's on its own."""
    if user_id == admin.user_id:
        raise ApiError(400, "self_deactivate", "You can't deactivate your own account.")
    user = db.get(User, user_id)
    if user is None:
        raise ApiError(404, "not_found", "User not found.")
    if user.role is Role.admin:
        keep_an_admin(db, admin.user_id, user_id)
        db.refresh(user)  # as the lock left it
    else:
        db.refresh(user, with_for_update=True)
    if user.deactivated_at is not None:
        raise ApiError(409, "already_deactivated", "This account is already deactivated.")

    user.deactivated_at = utc_now_ms()
    user.deactivated_by = admin.user_id
    user.deactivation_reason = body.reason
    db.flush()
    ended = revoke_all_for_user(db, user_id, "deactivated")  # commits the row too
    security_event(request, "account_deactivated", actor_id=admin.user_id, entity_type="User", entity_id=user_id,
                   detail={"reason": body.reason, "role": user.role.value, "ended": ended})
    return {"data": _state(user, ended)}


@router.post("/users/{user_id}/reactivate", response_model=Data[AccountState])
def reactivate_user(user_id: str, body: ReasonIn, admin: Admin, request: Request, db: AuditedDb):
    """Sign-in works again. activated_at and welcomed_at stay as they were,
    so a partner isn't welcomed twice; the old reason stays on the trail."""
    user = db.scalar(select(User).where(User.id == user_id).with_for_update())
    if user is None:
        raise ApiError(404, "not_found", "User not found.")
    if user.deactivated_at is None:
        raise ApiError(409, "not_deactivated", "This account isn't deactivated.")
    previous = user.deactivation_reason
    user.deactivated_at = None
    user.deactivated_by = None
    user.deactivation_reason = None
    db.commit()
    security_event(request, "account_reactivated", actor_id=admin.user_id, entity_type="User", entity_id=user_id,
                   detail={"reason": body.reason, "deactivation_reason": previous, "role": user.role.value})
    return {"data": _state(user)}


@router.post("/users/{user_id}/setup-email", response_model=Notifying[SetupSent])
def resend_setup_email(user_id: str, admin: Admin, request: Request, db: AuditedDb):
    """The setup email again, for a staff or partner login that hasn't set
    its password: the link works until one is set (7 days)."""
    user = db.get(User, user_id)
    if user is None:
        raise ApiError(404, "not_found", "User not found.")
    if user.role is Role.candidate:
        raise ApiError(422, "not_a_login", "Candidates create their account from their invite.")
    if user.deactivated_at is not None:
        raise _deactivated()
    if user.password_hash:
        raise ApiError(409, "password_set", "This account has set its password already — reset it instead.")
    if not account_email_allowed(request, user.email, user_id=user.id, kind="account_setup", actor_id=admin.user_id):
        raise ApiError(429, "email_limited", EMAIL_LIMITED)
    notify: list[Notice] = [AccountSetupEmail(email=user.email, full_name=user.full_name, token=sign_account_setup_token(user.id))]
    record_account_email(request, user, "account_setup", actor_id=admin.user_id)
    return {"data": {"email": user.email}, "notify": deliver(db, notify)}
