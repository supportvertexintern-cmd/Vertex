"""Admin → Monitoring (owner's requirements, 2026-11-07). Phase 1: User
Accounts, every login but candidates' (staff, partners, referral agents) in
one list, with each one's status, who created it, its latest sign-in and its
live sessions; and one account's detail, with its sessions and sign-in
history. Admins only (decision D1). The writes it links to are in users.py
(deactivate, reactivate, setup email) and sessions.py (end sessions).

Sign-ins are on the audit trail, which vertex_api may append to and not
read (Phase 10). Two functions answer only what this page shows (migration
0012), as for a case's history (0008). Opening an account's sign-in history
reads the trail, so it is itself recorded (audit_trail_viewed).

The list is filtered in the database where it can be, then by the latest
sign-in, which comes from the trail, then paginated: logins number in the
hundreds, not candidates' thousands.
"""

from __future__ import annotations

from dataclasses import asdict
from datetime import date, datetime, time, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel
from sqlalchemy import func, or_, select, text

from app.api.deps import DbSession
from app.api.v1.sessions import SessionRow, security_event
from app.core.api import ApiError, Data, Page, PageParams, UtcDateTime, page_params
from app.core.auth import AuthUser
from app.core.clock import utc_now_ms
from app.core.rbac import require_role
from app.models.enums import Role
from app.models.identity import RefreshToken, User
from app.models.partners import Partner
from app.services.sessions import list_sessions

router = APIRouter(prefix="/monitoring")

Admin = Annotated[AuthUser, Depends(require_role(Role.admin))]

AccountStatus = Literal["not_activated", "active", "deactivated"]
SortKey = Literal["created_at", "full_name", "last_sign_in_at"]
HISTORY_LIMIT = 50


# --- output -------------------------------------------------------------------


class Person(BaseModel):
    id: str
    full_name: str


class AccountRow(BaseModel):
    id: str
    full_name: str
    email: str
    role: Role
    # The partner agency a partner login belongs to.
    agency: str | None
    agency_id: str | None
    status: AccountStatus
    password_set: bool
    activated_at: UtcDateTime | None
    created_at: UtcDateTime
    created_by: Person | None
    last_sign_in_at: UtcDateTime | None
    last_sign_in_ip: str | None
    active_sessions: int
    deactivated_at: UtcDateTime | None
    deactivated_by: Person | None
    deactivation_reason: str | None


class SignIn(BaseModel):
    at: UtcDateTime
    succeeded: bool
    method: str | None
    # Why a sign-in was refused (bad_password, deactivated, ...).
    reason: str | None
    ip: str | None
    device: str | None


class AccountDetail(AccountRow):
    sessions: list[SessionRow]
    sign_ins: list[SignIn]


# --- helpers ------------------------------------------------------------------


def account_status(user: User) -> AccountStatus:
    if user.deactivated_at is not None:
        return "deactivated"
    return "active" if user.activated_at is not None else "not_activated"


def _rows(db, users: list[User]) -> list[dict[str, Any]]:
    """The list's columns for these accounts, in four queries whatever their number."""
    ids = [u.id for u in users]
    if not ids:
        return []
    last = {
        r.user_id: r
        for r in db.execute(text("SELECT user_id, signed_in_at, ip FROM public.vertex_last_sign_ins(:ids)"), {"ids": ids})
    }
    now = utc_now_ms()
    sessions = dict(
        db.execute(
            select(RefreshToken.user_id, func.count(func.distinct(RefreshToken.family_id)))
            .where(
                RefreshToken.user_id.in_(ids), RefreshToken.revoked_at.is_(None),
                RefreshToken.used_at.is_(None), RefreshToken.expires_at > now,
            )
            .group_by(RefreshToken.user_id)
        ).all()
    )
    agencies = {a.user_id: a for a in db.execute(select(Partner.user_id, Partner.id, Partner.name).where(Partner.user_id.in_(ids)))}
    people_ids = {u.created_by for u in users} | {u.deactivated_by for u in users}
    people_ids.discard(None)
    people = {p.id: {"id": p.id, "full_name": p.full_name} for p in db.execute(select(User.id, User.full_name).where(User.id.in_(people_ids)))}

    out = []
    for u in users:
        sign_in, agency = last.get(u.id), agencies.get(u.id)
        out.append({
            "id": u.id, "full_name": u.full_name, "email": u.email, "role": u.role,
            "agency": agency.name if agency else None, "agency_id": agency.id if agency else None,
            "status": account_status(u), "password_set": bool(u.password_hash), "activated_at": u.activated_at,
            "created_at": u.created_at, "created_by": people.get(u.created_by),
            "last_sign_in_at": sign_in.signed_in_at if sign_in else None, "last_sign_in_ip": sign_in.ip if sign_in else None,
            "active_sessions": sessions.get(u.id, 0),
            "deactivated_at": u.deactivated_at, "deactivated_by": people.get(u.deactivated_by),
            "deactivation_reason": u.deactivation_reason,
        })
    return out


def _start(day: date) -> datetime:
    return datetime.combine(day, time.min)


# --- routes -------------------------------------------------------------------


@router.get("/accounts", response_model=Page[AccountRow])
def list_accounts(
    _admin: Admin,
    db: DbSession,
    paging: Annotated[PageParams, Depends(page_params)],
    q: Annotated[str | None, Query(max_length=200)] = None,
    role: Role | None = None,
    status: AccountStatus | None = None,
    created_from: date | None = None,
    created_to: date | None = None,
    # Not signed in for this many days or more (never, if older than that).
    inactive_days: Annotated[int | None, Query(ge=1, le=3650)] = None,
    sort: SortKey = "created_at",
    direction: Literal["asc", "desc"] = "desc",
):
    query = select(User).where(User.role != Role.candidate)
    if role is not None:
        if role is Role.candidate:
            raise ApiError(422, "validation_error", "Validation failed", {"role": ["Candidates aren't listed here."]})
        query = query.where(User.role == role)
    if q and q.strip():
        like = f"%{q.strip()}%"
        query = query.where(or_(User.full_name.ilike(like), User.email.ilike(like)))
    if status == "deactivated":
        query = query.where(User.deactivated_at.is_not(None))
    elif status == "active":
        query = query.where(User.deactivated_at.is_(None), User.activated_at.is_not(None))
    elif status == "not_activated":
        query = query.where(User.deactivated_at.is_(None), User.activated_at.is_(None))
    if created_from is not None:
        query = query.where(User.created_at >= _start(created_from))
    if created_to is not None:
        query = query.where(User.created_at < _start(created_to + timedelta(days=1)))

    rows = _rows(db, list(db.scalars(query)))
    if inactive_days is not None:
        cutoff = utc_now_ms() - timedelta(days=inactive_days)
        rows = [r for r in rows if (r["last_sign_in_at"] or r["created_at"]) < cutoff]

    def key(r: dict[str, Any]) -> tuple:
        value = r[sort]
        # Never signed in sorts as the oldest.
        return (value is not None, value.lower() if isinstance(value, str) else value or datetime.min)

    rows.sort(key=key, reverse=direction == "desc")
    page = rows[paging.offset : paging.offset + paging.page_size]
    return {"data": page, "total": len(rows), "page": paging.page, "pageSize": paging.page_size}


@router.get("/accounts/{user_id}", response_model=Data[AccountDetail])
def get_account(user_id: str, admin: Admin, request: Request, db: DbSession):
    """One account, its live sessions and its latest sign-ins and refused
    sign-ins. Reading the history is recorded on the trail first."""
    user = db.get(User, user_id)
    if user is None or user.role is Role.candidate:
        raise ApiError(404, "not_found", "Account not found.")
    security_event(request, "audit_trail_viewed", actor_id=admin.user_id, entity_type="User", entity_id=user_id,
                   detail={"view": "sign_in_history"})
    history = db.execute(
        text("SELECT created_at, action, method, reason, ip, device FROM public.vertex_sign_in_history(:id, :n)"),
        {"id": user_id, "n": HISTORY_LIMIT},
    ).all()
    sign_ins = [
        {"at": h.created_at, "succeeded": h.action == "login_succeeded", "method": h.method, "reason": h.reason, "ip": h.ip, "device": h.device}
        for h in history
    ]
    sessions = [asdict(s) for s in list_sessions(db, user_id, None)]
    (row,) = _rows(db, [user])
    return {"data": row | {"sessions": sessions, "sign_ins": sign_ins}}
