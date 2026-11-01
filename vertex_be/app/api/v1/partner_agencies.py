"""Partner agencies, owned by FastAPI from users and sessions step 8.4
(docs/architecture/users-handover.md): an in-house supervisor, director or
admin adds a partner, edits it, removes it, and creates or resets its own
login. They replace POST /api/admin/partners, PATCH and DELETE
/api/admin/partners/[id], and POST /api/admin/partners/[id]/provision-account
and /reset-password, which pass requests on. The lists and details (GET)
stay in Next.js. (Employer clients, a different kind of partner, are in partners.py.)

They answer as those routes did: the same roles (a test fails if the lists
drift), messages, status codes and Prisma-shaped JSON. Every change is on
the audit trail. A login is created without a password; the setup email it
lists in `notify` lets the partner set their own.

What changes (users-handover.md §6):
  - Unknown fields are ignored (#11): a partner's status and its login come
    only from the fields and routes meant for them.
  - The partner row is locked while it's checked and changed, so two
    requests can't both give it a login, or remove it while it gains one.
  - A partner's login that has since been made an admin is removed only by
    an admin, and never if it's the last one.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status
from pydantic import AfterValidator, BaseModel, ConfigDict, StringConstraints
from pydantic_core import PydanticCustomError
from sqlalchemy import exists, func, select
from sqlalchemy.exc import IntegrityError

from app.api.notices import AccountSetupEmail, Notice, Notifying
from app.api.v1.users import keep_an_admin
from app.core.api import ApiError, Data, Email, UtcDateTime
from app.core.audit import AuditedDb
from app.core.auth import AuthUser
from app.core.clock import utc_now_ms
from app.core.rbac import require_role
from app.core.tokens import sign_account_setup_token
from app.models.candidate import Candidate
from app.models.enums import MouStatus, PartnerStatus, PartnerType, Role
from app.models.identity import User
from app.models.partners import Partner, PartnerCandidate

router = APIRouter()

# PARTNER_MANAGER_ROLES in each of the website's partner routes.
PARTNER_MANAGER_ROLES = (Role.inhouse_supervisor, Role.director, Role.admin)
Manager = Annotated[AuthUser, Depends(require_role(*PARTNER_MANAGER_ROLES))]


def _min(length: int, message: str):
    """z.string().min(length, message)."""

    def check(value: str) -> str:
        if len(value) < length:
            raise PydanticCustomError("value_error", message)
        return value

    return AfterValidator(check)


def _text(low: int, high: int, message: str | None = None):
    if message is None:
        return Annotated[str, StringConstraints(min_length=low, max_length=high)]
    return Annotated[str, StringConstraints(max_length=high), _min(low, message)]


# --- input --------------------------------------------------------------------


class CreateIn(BaseModel):
    """createPartnerSchema."""

    name: _text(2, 150, "Name is required")
    partner_type: PartnerType
    country_of_operation: _text(2, 100, "Country of operation is required")
    business_registration_number: Annotated[str, StringConstraints(max_length=100)] | None = None
    contact_name: _text(2, 150, "Contact name is required")
    contact_email: Email
    contact_phone: _text(3, 30, "Contact phone is required")
    notes: Annotated[str, StringConstraints(max_length=2000)] | None = None


class UpdateIn(BaseModel):
    """updatePartnerSchema: a field left out is left alone. Only
    business_registration_number and notes may be cleared with null."""

    name: _text(2, 150) | None = None
    partner_type: PartnerType | None = None
    country_of_operation: _text(2, 100) | None = None
    business_registration_number: Annotated[str, StringConstraints(max_length=100)] | None = None
    contact_name: _text(2, 150) | None = None
    contact_email: Email | None = None
    contact_phone: _text(3, 30) | None = None
    status: PartnerStatus | None = None
    mou_status: MouStatus | None = None
    notes: Annotated[str, StringConstraints(max_length=2000)] | None = None


NULLABLE = {"business_registration_number", "notes"}


class LoginIn(BaseModel):
    """provisionPartnerAccountSchema: the login's address, the contact
    email unless given."""

    email: Email | None = None


def _no_nulls(body: BaseModel, nullable: set[str] = frozenset()) -> None:
    """zod's .optional() takes a missing field, not a null one."""
    sent_null = sorted(f for f in body.model_fields_set if getattr(body, f) is None and f not in nullable)
    if sent_null:
        raise ApiError(422, "validation_error", "Validation failed", {f: ["Invalid input: expected a value, received null"] for f in sent_null})


# --- output -------------------------------------------------------------------


class PartnerRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    partner_type: PartnerType
    country_of_operation: str
    business_registration_number: str | None
    contact_name: str
    contact_email: str
    contact_phone: str
    status: PartnerStatus
    mou_status: MouStatus
    mou_signed_at: UtcDateTime | None
    notes: str | None
    created_at: UtcDateTime
    updated_at: UtcDateTime
    user_id: str | None


class Removed(BaseModel):
    id: str


class LoginAddress(BaseModel):
    email: str


# --- helpers ------------------------------------------------------------------


def _locked(db, partner_id: str) -> Partner:
    partner = db.scalar(select(Partner).where(Partner.id == partner_id).with_for_update())
    if partner is None:
        raise ApiError(404, "not_found", "Partner not found.")
    return partner


def _duplicate() -> ApiError:
    return ApiError(409, "duplicate", "A user with this email already exists.")


def _setup_email(user: User) -> Notice:
    return AccountSetupEmail(email=user.email, full_name=user.full_name, token=sign_account_setup_token(user.id))


def _saved(db) -> None:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()  # the address was taken meanwhile
        raise _duplicate() from None


# --- routes -------------------------------------------------------------------


@router.post("/partners", status_code=status.HTTP_201_CREATED, response_model=Data[PartnerRow])
def create_partner(body: CreateIn, _user: Manager, db: AuditedDb):
    _no_nulls(body)
    partner = Partner(**body.model_dump(exclude_unset=True))
    db.add(partner)
    db.commit()
    db.refresh(partner)
    return {"data": partner}


@router.patch("/partners/{partner_id}", response_model=Notifying[PartnerRow])
def update_partner(partner_id: str, body: UpdateIn, _user: Manager, db: AuditedDb):
    """Every editable field. Marking the MOU signed stamps mou_signed_at. A
    new contact_email on a partner with a login moves the login too: its
    password is cleared and the setup email goes to the new address, so the
    old password stops working and the new address proves itself."""
    partner = _locked(db, partner_id)
    _no_nulls(body, NULLABLE)
    changes = body.model_dump(exclude_unset=True)

    email_changed = "contact_email" in changes and changes["contact_email"] != partner.contact_email
    login = db.get(User, partner.user_id) if email_changed and partner.user_id else None
    if login is not None and db.scalar(select(exists().where(User.email == changes["contact_email"], User.id != login.id))):
        raise _duplicate()

    if changes.get("mou_status") is MouStatus.signed and partner.mou_status is not MouStatus.signed:
        partner.mou_signed_at = utc_now_ms()
    for field, value in changes.items():
        setattr(partner, field, value)
    notify: list[Notice] = []
    if login is not None:
        login.email = changes["contact_email"]
        login.password_hash = None
        notify.append(_setup_email(login))
    _saved(db)
    db.refresh(partner)
    return {"data": partner, "notify": notify}


@router.delete("/partners/{partner_id}", response_model=Data[Removed])
def delete_partner(partner_id: str, user: Manager, db: AuditedDb):
    """Refused while any candidate or submission is on file (PartnerCandidate
    rows would cascade away). The partner's login goes with it."""
    partner = _locked(db, partner_id)
    activity = db.scalar(select(func.count()).select_from(Candidate).where(Candidate.partner_id == partner_id)) + db.scalar(
        select(func.count()).select_from(PartnerCandidate).where(PartnerCandidate.partner_id == partner_id)
    )
    if activity > 0:
        message = f"This partner has {activity} candidate submission(s) on file — remove or reassign them first."
        raise ApiError(409, "has_activity", message)

    login = db.get(User, partner.user_id) if partner.user_id else None
    if login is not None and login.role is Role.admin:
        keep_an_admin(db, user.user_id, login.id)
    db.delete(partner)
    if login is not None:
        db.delete(login)
    db.commit()
    return {"data": {"id": partner_id}}


@router.post("/partners/{partner_id}/provision-account", status_code=status.HTTP_201_CREATED, response_model=Notifying[PartnerRow])
def provision_account(partner_id: str, body: LoginIn, _user: Manager, db: AuditedDb):
    """The partner's own login (SRS FR-5.1), with no password: the setup
    email lets them set it."""
    partner = _locked(db, partner_id)
    if partner.user_id:
        raise ApiError(409, "already_provisioned", "This partner already has a login.")
    _no_nulls(body)
    email = body.email or partner.contact_email
    if db.scalar(select(exists().where(User.email == email))):
        raise _duplicate()

    login = User(full_name=partner.contact_name, email=email, role=Role.partner, email_verified=False)
    db.add(login)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise _duplicate() from None
    partner.user_id = login.id
    _saved(db)
    db.refresh(partner)
    return {"data": partner, "notify": [_setup_email(login)]}


@router.post("/partners/{partner_id}/reset-password", response_model=Notifying[LoginAddress])
def reset_password(partner_id: str, _user: Manager, db: AuditedDb):
    """Clears the login's password, so it stops working at once (and its
    sessions end: the token_version trigger), and sends the setup email."""
    partner = _locked(db, partner_id)
    if not partner.user_id:
        raise ApiError(422, "no_account", "This partner has no login yet — use Create Partner Login instead.")
    login = db.get(User, partner.user_id)
    login.password_hash = None
    db.commit()
    return {"data": {"email": login.email}, "notify": [_setup_email(login)]}

