"""The admin's user pages, owned by FastAPI from users and sessions step 8.3
(docs/architecture/users-handover.md): create a staff account (with its
setup email), change a user's role, supervisor and countries, delete one,
and reset one's password to a temporary one. They replace POST
/api/admin/users, PATCH and DELETE /api/admin/users/[id] and POST
/api/admin/users/[id]/reset-password, which pass requests on while
FLAG_ACCOUNTS_FASTAPI_ADMIN_USERS is on. The directory (GET) stays in
Next.js.

They answer as those routes did: admins only (a test fails if the lists
drift), the same messages, status codes and JSON. Every change is on the
audit trail. When an account becomes an admin the answer says so in
`privilege_granted`, and the website raises the alert it always raised.

What changes (security review #11, #12):
  - Nobody changes their own role, and the last admin can't be demoted or
    deleted. The admin rows are locked while that's checked, so two admins
    demoting each other at once can't leave none.
  - Unknown fields are ignored.
"""

from __future__ import annotations

import secrets
from typing import Annotated, Any

from fastapi import APIRouter, Depends, status
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints
from pydantic_core import PydanticCustomError
from sqlalchemy import exists, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app.api.notices import AccountSetupEmail, Notice, Notifying
from app.core.api import ApiError, Data, Email
from app.core.audit import AuditedDb
from app.core.auth import AuthUser
from app.core.rbac import is_staff_role, require_role
from app.core.tokens import sign_account_setup_token
from app.models.enums import Role
from app.models.identity import Country, InhouseCountryAssignment, User
from app.services.sessions import hash_password

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


def _keep_an_admin(db, actor_id: str, target_id: str) -> None:
    """Before an admin is demoted or deleted: locks every admin row, in id
    order, so two such requests wait for each other and the second sees the
    first's change. Refuses if the target is the last admin, or if the
    caller stopped being one meanwhile."""
    admins = set(db.scalars(select(User.id).where(User.role == Role.admin).order_by(User.id).with_for_update()))
    if not admins - {target_id}:
        raise ApiError(409, "last_admin", "There must always be at least one admin.")
    if actor_id not in admins:
        raise ApiError(403, "forbidden", "Forbidden")


def _granted(was: Role | None, now: Role) -> dict[str, Any] | None:
    return {"from": was, "to": now} if now is Role.admin and was is not Role.admin else None


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
def create_user(body: CreateIn, admin: Admin, db: AuditedDb):
    """A new staff account with no password: the setup email lets them set
    their own."""
    if db.scalar(select(exists().where(User.email == body.email))):
        raise ApiError(409, "duplicate", "A user with this email already exists.")
    _check_supervisor(db, body.supervisor_id)
    _check_countries(db, body.assigned_country_id, body.assigned_country_ids)

    user = User(
        full_name=body.full_name, email=body.email, role=body.role, email_verified=False,
        supervisor_id=body.supervisor_id, assigned_country_id=body.assigned_country_id,
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
    return {"data": _row(db, user), "notify": notify, "privilege_granted": _granted(None, user.role)}


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
            _keep_an_admin(db, admin.user_id, user_id)
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
    return {"data": _row(db, user), "privilege_granted": _granted(was, user.role)}


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
        _keep_an_admin(db, admin.user_id, user_id)
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
    temporary = secrets.token_urlsafe(12)  # generateTemporaryPassword(): 12 random bytes, base64url
    user.password_hash = hash_password(temporary)
    db.commit()
    return {"data": {"id": user_id}, "temporaryPassword": temporary}
