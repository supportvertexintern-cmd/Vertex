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
  - Suspending a partner deactivates its login (owner's decision D2,
    2026-11-07): the sessions end and it can't sign in. Making the partner
    active again leaves the login deactivated; an admin reactivates it
    deliberately (Admin → Monitoring → User Accounts).
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request, status
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints
from pydantic_core import PydanticCustomError
from sqlalchemy import exists, func, select
from sqlalchemy.exc import IntegrityError

from app.api.deps import DbSession
from app.api.notices import AccountSetupEmail, Notice, Notifying
from app.services.emails import deliver
from app.api.v1.sessions import security_event
from app.api.v1.users import keep_an_admin
from app.core.api import ApiError, Data, Email, UtcDateTime
from app.core.audit import AuditedDb
from app.core.auth import AuthUser
from app.core.clock import utc_now_ms
from app.core.rbac import require_role
from app.core.scope import candidate_scope
from app.core.tokens import sign_account_setup_token
from app.services.sessions import revoke_all_for_user
from app.models.candidate import Candidate
from app.models.enums import CandidateLifecycleStatus, MouStatus, PartnerStatus, PartnerType, Role
from app.models.identity import User
from app.models.partners import Partner, PartnerCandidate

router = APIRouter()

# PARTNER_MANAGER_ROLES in each of the website's partner routes.
PARTNER_MANAGER_ROLES = (Role.inhouse_supervisor, Role.director, Role.admin)
Manager = Annotated[AuthUser, Depends(require_role(*PARTNER_MANAGER_ROLES))]

# Reads (reads handover R2). The list: every role that filters by partner or
# submits for one; only the managers get the full rows, the rest the name
# (owner's decision, 2026-11-02). Must match GET /api/admin/partners.
PARTNER_LIST_READERS = (
    Role.regional_recruiter, Role.country_supervisor, Role.inhouse_supervisor, Role.director, Role.admin,
    Role.hr, Role.operations_team, Role.operations_director, Role.finance,
)
# A partner's page. Recruiters and country supervisors see only the
# partner's candidates they may see anyway (policy question Q1, owner's
# decision 2026-11-02). Must match GET /api/admin/partners/[id].
PARTNER_DETAIL_READERS = (Role.regional_recruiter, Role.country_supervisor, *PARTNER_MANAGER_ROLES)
ListReader = Annotated[AuthUser, Depends(require_role(*PARTNER_LIST_READERS))]
DetailReader = Annotated[AuthUser, Depends(require_role(*PARTNER_DETAIL_READERS))]


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
    # Who added the agency (migration 0014).
    created_by: str | None = None


class CandidateCount(BaseModel):
    candidates: int


class PartnerListRow(PartnerRow):
    """A manager's row: the partner and its candidate count (Prisma's _count)."""

    count: CandidateCount = Field(serialization_alias="_count")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class PartnerName(BaseModel):
    """Everyone else's row: enough to pick or filter by a partner."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    status: PartnerStatus


class PersonRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    full_name: str
    email: str


class RecruiterRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    full_name: str


class PartnerCandidateRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    full_name: str
    lifecycle_status: CandidateLifecycleStatus
    created_at: UtcDateTime
    user: PersonRef | None
    recruiter: RecruiterRef | None


class PartnerDetail(PartnerRow):
    candidates: list[PartnerCandidateRef]
    # When the partner's login first signed in (its activation); null while
    # it never has, or there's no login.
    login_activated_at: UtcDateTime | None = None
    # When an admin, or the partner's suspension, deactivated the login.
    login_deactivated_at: UtcDateTime | None = None


def _columns(partner: Partner) -> dict[str, object]:
    """The partner's own fields, to add a relation the row doesn't carry."""
    return {name: getattr(partner, name) for name in PartnerRow.model_fields}


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


SUSPENDED_REASON = "Partner agency suspended"


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


# --- reading (reads handover R2) ----------------------------------------------


@router.get("/partners", response_model=Data[list[PartnerListRow] | list[PartnerName]])
def list_partners(db: DbSession, user: ListReader):
    """Every partner, by name: full rows with candidate counts for a
    partner manager, the name and status for everyone else."""
    partners = list(db.scalars(select(Partner).order_by(Partner.name)))
    if user.role not in PARTNER_MANAGER_ROLES:
        return Data(data=[PartnerName.model_validate(p) for p in partners])
    counts = dict(db.execute(select(Candidate.partner_id, func.count()).where(Candidate.partner_id.is_not(None)).group_by(Candidate.partner_id)).all())
    return Data(data=[PartnerListRow.model_validate(_columns(p) | {"count": {"candidates": counts.get(p.id, 0)}}) for p in partners])


@router.get("/partners/{partner_id}", response_model=Data[PartnerDetail])
def get_partner(partner_id: str, db: DbSession, user: DetailReader):
    """A partner and its candidates, newest first: all of them for a
    partner manager, the ones in their own scope for a recruiter or a
    country supervisor."""
    partner = db.get(Partner, partner_id)
    if partner is None:
        raise ApiError(404, "not_found", "Partner not found.")
    query = select(Candidate).where(Candidate.partner_id == partner.id).order_by(Candidate.created_at.desc())
    if user.role not in PARTNER_MANAGER_ROLES:
        query = query.where(candidate_scope(db, user))
    candidates = [PartnerCandidateRef.model_validate(c) for c in db.scalars(query)]
    login = db.get(User, partner.user_id) if partner.user_id else None
    activated = login.activated_at if login else None
    deactivated = login.deactivated_at if login else None
    return Data(data=PartnerDetail.model_validate(
        _columns(partner) | {"candidates": candidates, "login_activated_at": activated, "login_deactivated_at": deactivated}
    ))


@router.post("/partners", status_code=status.HTTP_201_CREATED, response_model=Data[PartnerRow])
def create_partner(body: CreateIn, manager: Manager, db: AuditedDb):
    _no_nulls(body)
    partner = Partner(**body.model_dump(exclude_unset=True), created_by=manager.user_id)
    db.add(partner)
    db.commit()
    db.refresh(partner)
    return {"data": partner}


@router.patch("/partners/{partner_id}", response_model=Notifying[PartnerRow])
def update_partner(partner_id: str, body: UpdateIn, manager: Manager, request: Request, db: AuditedDb):
    """Every editable field. Marking the MOU signed stamps mou_signed_at. A
    new contact_email on a partner with a login moves the login too: its
    password is cleared and the setup email goes to the new address, so the
    old password stops working and the new address proves itself.
    Suspending the partner deactivates its login (D2)."""
    partner = _locked(db, partner_id)
    _no_nulls(body, NULLABLE)
    changes = body.model_dump(exclude_unset=True)
    suspending = changes.get("status") is PartnerStatus.suspended and partner.status is not PartnerStatus.suspended
    owner = db.get(User, partner.user_id) if suspending and partner.user_id else None
    if owner is not None and (owner.role is not Role.partner or owner.deactivated_at is not None):
        owner = None  # a login since made staff is an admin's to deactivate

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
    if owner is not None:
        owner.deactivated_at = utc_now_ms()
        owner.deactivated_by = manager.user_id
        owner.deactivation_reason = SUSPENDED_REASON
    _saved(db)
    if owner is not None:
        ended = revoke_all_for_user(db, owner.id, "deactivated")
        security_event(request, "account_deactivated", actor_id=manager.user_id, entity_type="User", entity_id=owner.id,
                       detail={"reason": SUSPENDED_REASON, "role": owner.role.value, "ended": ended, "partner": partner_id})
    db.refresh(partner)
    return {"data": partner, "notify": deliver(db, notify)}


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
def provision_account(partner_id: str, body: LoginIn, manager: Manager, db: AuditedDb):
    """The partner's own login (SRS FR-5.1), with no password: the setup
    email lets them set it."""
    partner = _locked(db, partner_id)
    if partner.user_id:
        raise ApiError(409, "already_provisioned", "This partner already has a login.")
    _no_nulls(body)
    email = body.email or partner.contact_email
    if db.scalar(select(exists().where(User.email == email))):
        raise _duplicate()

    login = User(full_name=partner.contact_name, email=email, role=Role.partner, email_verified=False, created_by=manager.user_id)
    db.add(login)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise _duplicate() from None
    partner.user_id = login.id
    _saved(db)
    db.refresh(partner)
    return {"data": partner, "notify": deliver(db, [_setup_email(login)])}


@router.post("/partners/{partner_id}/reset-password", response_model=Notifying[LoginAddress])
def reset_password(partner_id: str, _user: Manager, db: AuditedDb):
    """Clears the login's password, so it stops working at once (and its
    sessions end: the token_version trigger), and sends the setup email."""
    partner = _locked(db, partner_id)
    if not partner.user_id:
        raise ApiError(422, "no_account", "This partner has no login yet — use Create Partner Login instead.")
    login = db.get(User, partner.user_id)
    if login.deactivated_at is not None:
        raise ApiError(409, "account_deactivated", "This partner's login is deactivated — an admin must reactivate it first.")
    login.password_hash = None
    db.commit()
    return {"data": {"email": login.email}, "notify": deliver(db, [_setup_email(login)])}


# --- first-time welcome (owner's requirement 2026-11-07) ---------------------


class Welcome(BaseModel):
    show: bool
    agency_name: str | None
    activated_at: UtcDateTime | None


@router.post("/partner/welcome", response_model=Data[Welcome])
def partner_welcome(user: Annotated[AuthUser, Depends(require_role(Role.partner))], db: AuditedDb):
    """The partner portal's first-time welcome: show is true once, the first
    time the portal asks after the login was activated (its first sign-in),
    and false from then on. The row is locked, so two requests at once can't
    both get it. The agency's own status and MOU are left as they are."""
    login = db.scalar(select(User).where(User.id == user.user_id).with_for_update())
    if login is None:
        raise ApiError(404, "not_found", "Account not found.")
    show = login.activated_at is not None and login.welcomed_at is None
    if show:
        login.welcomed_at = utc_now_ms()
    agency = db.scalar(select(Partner.name).where(Partner.user_id == login.id))
    activated_at = login.activated_at
    db.commit()
    return {"data": {"show": show, "agency_name": agency, "activated_at": activated_at}}
