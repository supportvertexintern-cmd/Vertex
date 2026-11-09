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

Phase 2: Suspicious Activity. Every alert the security monitor raises is a
SecurityAlert row (migration 0013). Admins list them, and move each from
open to reviewing, resolved or dismissed; resolving or dismissing needs a
note. Each change is an audited row change: who, when, the note. An open
or reviewing alert is a flag on its account in User Accounts.

Phase 3: Partners & Logins. One row per partner agency: its business status
and MOU, when and by whom it was added (Partner.created_by, migration
0014), and its login, if any: when and by whom that was created, its status
and latest sign-in. The CSV of the filtered list is recorded on the trail
before it leaves (as every export), and refused if it can't be.

Phase 4: the Audit Trail, read-only: who did what and when, filtered and
paged through vertex_audit_trail (migration 0015). Each read is itself
recorded (audit_trail_viewed, with its filters). Nothing here changes it.

Phase 5: the Security Overview: counts for the last 24 hours and 7 days,
each linking to its page, and the latest alerts; and the account checks,
run on a schedule (security_monitor.run_account_checks) or from here.

Owner's additions (2026-11-07): the country of each address (the bundled
DB-IP database, app/services/geoip.py), on every page that shows one;
Locked Accounts, the ones the per-account sign-in limit is holding now,
which an admin can unlock (recorded as login_unlocked); and the script-like
activity rules, raised by app/services/activity.py.
"""

from __future__ import annotations

from dataclasses import asdict
from datetime import date, datetime, time, timedelta
from typing import Annotated, Any, Literal, get_args

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel, StringConstraints
from sqlalchemy import func, or_, select, text

from app.api.deps import DbSession
from app.api.notices import AccountSetupEmail, Notifying, PasswordResetEmail
from app.api.v1.sessions import EMAIL_LIMITED, SessionRow, account_email_allowed, security_event
from app.core.api import ApiError, Data, Page, PageParams, UtcDateTime, page_params
from app.core.audit import AuditedDb, append_event
from app.core.auth import AuthUser
from app.core.clock import utc_now_ms
from app.core.config import settings
from app.core.rbac import require_role
from app.models.enums import LockoutEnd, MouStatus, PartnerStatus, PartnerType, Role, SecurityAlertSeverity, SecurityAlertStatus
from app.models.identity import RefreshToken, User
from app.models.partners import Partner
from app.models.security import LoginLockout, SecurityAlert
from app.services import geoip, login_lockout, security_monitor
from app.services.sessions import email_fingerprint, list_sessions
from app.core.tokens import sign_account_setup_token, sign_reset_token
from app.services.emails import deliver

router = APIRouter(prefix="/monitoring")

Admin = Annotated[AuthUser, Depends(require_role(Role.admin))]

AccountStatus = Literal["not_activated", "active", "deactivated"]
UNREVIEWED = (SecurityAlertStatus.open, SecurityAlertStatus.reviewing)
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
    last_sign_in_country: str | None
    active_sessions: int
    deactivated_at: UtcDateTime | None
    deactivated_by: Person | None
    deactivation_reason: str | None
    # Open or reviewing security alerts about the account.
    open_alerts: int


class SignIn(BaseModel):
    at: UtcDateTime
    succeeded: bool
    method: str | None
    # Why a sign-in was refused (bad_password, deactivated, ...).
    reason: str | None
    ip: str | None
    country: str | None
    device: str | None


class AlertAccount(BaseModel):
    id: str
    full_name: str
    email: str
    role: Role
    deactivated: bool


class LockoutRow(BaseModel):
    """One sign-in lockout (login protection), as history."""

    id: str
    email_fp: str
    account: AlertAccount | None
    step: int
    locked_at: UtcDateTime
    locked_until: UtcDateTime
    failures: int
    last_ip: str | None
    last_country: str | None
    # Still holding the address.
    holding: bool
    ended_at: UtcDateTime | None
    ended_by: LockoutEnd | None
    ended_by_person: Person | None
    end_reason: str | None
    needs_review: bool
    reviewed_at: UtcDateTime | None
    reviewed_by: Person | None
    review_note: str | None


class AccountDetail(AccountRow):
    sessions: list[SessionRow]
    sign_ins: list[SignIn]
    # Held by the per-account sign-in limit now (too many failed sign-ins).
    locked: bool
    unlocks_in_seconds: int | None
    email_fp: str
    # Login protection: its lockouts (newest first, within the retention
    # window), the step the next one would be, and when that falls back to 1.
    lockouts: list[LockoutRow]
    next_lockout_step: int
    steps_reset_at: UtcDateTime | None


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
    cutoff = security_monitor.retention_cutoff()  # D3: a sign-in older than the window isn't shown
    last = {
        r.user_id: r
        for r in db.execute(text("SELECT user_id, signed_in_at, ip FROM public.vertex_last_sign_ins(:ids)"), {"ids": ids})
        if r.signed_in_at >= cutoff
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
    flags = dict(
        db.execute(
            select(SecurityAlert.user_id, func.count()).where(SecurityAlert.user_id.in_(ids), SecurityAlert.status.in_(UNREVIEWED))
            .group_by(SecurityAlert.user_id)
        ).all()
    )
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
            "last_sign_in_country": geoip.country_of(sign_in.ip) if sign_in else None,
            "active_sessions": sessions.get(u.id, 0),
            "deactivated_at": u.deactivated_at, "deactivated_by": people.get(u.deactivated_by),
            "deactivation_reason": u.deactivation_reason, "open_alerts": flags.get(u.id, 0),
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
    # Only accounts with open or reviewing security alerts.
    flagged: bool = False,
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
    if flagged:
        rows = [r for r in rows if r["open_alerts"]]
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
    cutoff = security_monitor.retention_cutoff()  # D3: older history isn't shown
    sign_ins = [
        {"at": h.created_at, "succeeded": h.action == "login_succeeded", "method": h.method, "reason": h.reason, "ip": h.ip,
         "country": geoip.country_of(h.ip), "device": h.device}
        for h in history if h.created_at >= cutoff
    ]
    sessions = [asdict(s) for s in list_sessions(db, user_id, None)]
    (row,) = _rows(db, [user])
    fp = email_fingerprint(user.email)
    holding = login_lockout.open_lockout(db, fp)
    lockouts = list(db.scalars(
        select(LoginLockout).where(or_(LoginLockout.user_id == user.id, LoginLockout.email_fp == fp), LoginLockout.locked_at >= cutoff)
        .order_by(LoginLockout.locked_at.desc()).limit(20)
    ))
    step, resets_at = login_lockout.escalation(db, fp)
    return {"data": row | {"sessions": sessions, "sign_ins": sign_ins, "locked": holding is not None,
                           "unlocks_in_seconds": login_lockout.seconds_left(holding) if holding else None, "email_fp": fp,
                           "lockouts": _lockout_rows(db, lockouts), "next_lockout_step": step, "steps_reset_at": resets_at}}


# --- Suspicious Activity (phase 2) ------------------------------------------------


class AlertRow(BaseModel):
    id: str
    rule: str
    severity: SecurityAlertSeverity
    summary: str
    account: AlertAccount | None
    ip: str | None
    country: str | None
    detail: dict[str, Any] | None
    status: SecurityAlertStatus
    reviewed_by: Person | None
    reviewed_at: UtcDateTime | None
    note: str | None
    created_at: UtcDateTime


class AlertSummary(BaseModel):
    # Open alerts (not yet looked at), for the sidebar's badge.
    open: int
    reviewing: int
    open_by_severity: dict[SecurityAlertSeverity, int]


class ReviewIn(BaseModel):
    status: SecurityAlertStatus
    note: Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)] | None = None


def _alert_rows(db, alerts: list[SecurityAlert]) -> list[dict[str, Any]]:
    ids = {a.user_id for a in alerts} | {a.reviewed_by for a in alerts}
    ids.discard(None)
    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_(ids)))} if ids else {}

    def account(user_id: str | None) -> dict[str, Any] | None:
        u = users.get(user_id) if user_id else None
        if u is None:
            return None
        return {"id": u.id, "full_name": u.full_name, "email": u.email, "role": u.role, "deactivated": u.deactivated_at is not None}

    def person(user_id: str | None) -> dict[str, Any] | None:
        u = users.get(user_id) if user_id else None
        return {"id": u.id, "full_name": u.full_name} if u else None

    return [
        {
            "id": a.id, "rule": a.rule, "severity": a.severity, "summary": a.summary, "account": account(a.user_id),
            "ip": a.ip, "country": (a.detail or {}).get("country") or geoip.country_of(a.ip), "detail": a.detail,
            "status": a.status, "reviewed_by": person(a.reviewed_by),
            "reviewed_at": a.reviewed_at, "note": a.note, "created_at": a.created_at,
        }
        for a in alerts
    ]


@router.get("/alerts", response_model=Page[AlertRow])
def list_alerts(
    _admin: Admin,
    db: DbSession,
    paging: Annotated[PageParams, Depends(page_params)],
    status: Annotated[list[SecurityAlertStatus] | None, Query()] = None,
    severity: SecurityAlertSeverity | None = None,
    rule: Annotated[str | None, Query(max_length=100)] = None,
    user_id: Annotated[str | None, Query(max_length=100)] = None,
    date_from: date | None = None,
    date_to: date | None = None,
):
    """Newest first. status may repeat (?status=open&status=reviewing)."""
    query = select(SecurityAlert)
    if status:
        query = query.where(SecurityAlert.status.in_(status))
    if severity is not None:
        query = query.where(SecurityAlert.severity == severity)
    if rule:
        query = query.where(SecurityAlert.rule == rule)
    if user_id:
        query = query.where(SecurityAlert.user_id == user_id)
    if date_from is not None:
        query = query.where(SecurityAlert.created_at >= _start(date_from))
    if date_to is not None:
        query = query.where(SecurityAlert.created_at < _start(date_to + timedelta(days=1)))
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    alerts = list(db.scalars(query.order_by(SecurityAlert.created_at.desc(), SecurityAlert.id.desc()).offset(paging.offset).limit(paging.page_size)))
    return {"data": _alert_rows(db, alerts), "total": total, "page": paging.page, "pageSize": paging.page_size}


@router.get("/alerts/summary", response_model=Data[AlertSummary])
def alert_summary(_admin: Admin, db: DbSession):
    counts = db.execute(
        select(SecurityAlert.status, SecurityAlert.severity, func.count()).where(SecurityAlert.status.in_(UNREVIEWED))
        .group_by(SecurityAlert.status, SecurityAlert.severity)
    ).all()
    by_severity = {s: 0 for s in SecurityAlertSeverity}
    totals = {s: 0 for s in UNREVIEWED}
    for state, level, n in counts:
        totals[state] += n
        if state is SecurityAlertStatus.open:
            by_severity[level] += n
    return {"data": {"open": totals[SecurityAlertStatus.open], "reviewing": totals[SecurityAlertStatus.reviewing], "open_by_severity": by_severity}}


@router.get("/alerts/rules", response_model=Data[list[str]])
def alert_rules(_admin: Admin, db: DbSession):
    """The rules that have raised an alert, for the type filter."""
    return {"data": list(db.scalars(select(SecurityAlert.rule).distinct().order_by(SecurityAlert.rule)))}


CLOSED = (SecurityAlertStatus.resolved, SecurityAlertStatus.dismissed)


@router.patch("/alerts/{alert_id}", response_model=Data[AlertRow])
def review_alert(alert_id: str, body: ReviewIn, admin: Admin, db: AuditedDb):
    """Moves an alert along: open -> reviewing -> resolved or dismissed (a
    false positive). Resolving or dismissing needs a note; reopening one
    is allowed, back to reviewing, with a note too. The row is locked, so
    two admins can't overwrite each other's review unseen."""
    alert = db.scalar(select(SecurityAlert).where(SecurityAlert.id == alert_id).with_for_update())
    if alert is None:
        raise ApiError(404, "not_found", "Alert not found.")
    target = body.status
    if target is alert.status:
        raise ApiError(409, "unchanged", f"This alert is already {target.value}.")
    if target is SecurityAlertStatus.open:
        raise ApiError(422, "invalid_transition", "An alert can't go back to open; mark it reviewing instead.")
    note = body.note or None
    if (target in CLOSED or alert.status in CLOSED) and not (note and len(note) >= 3):
        raise ApiError(422, "note_required", "Add a note (at least 3 characters) saying what was found.", {"note": ["A note is required."]})
    alert.status = target
    alert.reviewed_by = admin.user_id
    alert.reviewed_at = utc_now_ms()
    if note:
        alert.note = note
    db.commit()
    db.refresh(alert)
    return {"data": _alert_rows(db, [alert])[0]}


# --- Partners & Logins (phase 3) ----------------------------------------------------

LoginStatus = Literal["no_login", "setup_pending", "active", "deactivated"]


class PartnerLogin(BaseModel):
    id: str
    email: str
    status: Literal["setup_pending", "active", "deactivated"]
    password_set: bool
    created_at: UtcDateTime
    created_by: Person | None
    activated_at: UtcDateTime | None
    deactivated_at: UtcDateTime | None
    last_sign_in_at: UtcDateTime | None
    last_sign_in_ip: str | None
    last_sign_in_country: str | None


# A login that needs following up (the scheduled checks' definitions):
# setup_overdue, its setup email unused NOT_ACTIVATED_AFTER_DAYS (7) or more;
# inactive, active but not signed in for INACTIVE_AFTER_DAYS (60, D5) or more.
Attention = Literal["setup_overdue", "inactive"]


class Window(BaseModel):
    last_24h: int
    last_7d: int


class PartnerAttention(BaseModel):
    kind: Attention
    days: int


class PartnerLoginRow(BaseModel):
    id: str
    name: str
    partner_type: PartnerType
    country_of_operation: str
    status: PartnerStatus
    mou_status: MouStatus
    created_at: UtcDateTime
    created_by: Person | None
    login_status: LoginStatus
    login: PartnerLogin | None
    attention: PartnerAttention | None


class PartnerOptions(BaseModel):
    countries: list[str]
    creators: list[Person]


def _login_status(login: User | None) -> LoginStatus:
    if login is None:
        return "no_login"
    status = account_status(login)
    return "setup_pending" if status == "not_activated" else status


def _partner_rows(db, partners: list[Partner]) -> list[dict[str, Any]]:
    login_ids = [p.user_id for p in partners if p.user_id]
    logins = {u.id: u for u in db.scalars(select(User).where(User.id.in_(login_ids)))} if login_ids else {}
    last = (
        {r.user_id: r for r in db.execute(text("SELECT user_id, signed_in_at, ip FROM public.vertex_last_sign_ins(:ids)"), {"ids": login_ids})}
        if login_ids else {}
    )
    people_ids = {p.created_by for p in partners} | {u.created_by for u in logins.values()}
    people_ids.discard(None)
    people = {r.id: {"id": r.id, "full_name": r.full_name} for r in db.execute(select(User.id, User.full_name).where(User.id.in_(people_ids)))} if people_ids else {}

    overdue = security_monitor.overdue_setups(db) if login_ids else {}
    inactive = security_monitor.inactive_logins(db) if login_ids else {}

    out = []
    for p in partners:
        login = logins.get(p.user_id) if p.user_id else None
        attention = None
        if login is not None and login.id in overdue:
            attention = {"kind": "setup_overdue", "days": overdue[login.id]}
        elif login is not None and login.id in inactive:
            attention = {"kind": "inactive", "days": inactive[login.id]}
        status = _login_status(login)
        sign_in = last.get(login.id) if login else None
        out.append({
            "id": p.id, "name": p.name, "partner_type": p.partner_type, "country_of_operation": p.country_of_operation,
            "status": p.status, "mou_status": p.mou_status, "created_at": p.created_at, "created_by": people.get(p.created_by),
            "login_status": status,
            "login": None if login is None else {
                "id": login.id, "email": login.email, "status": status, "password_set": bool(login.password_hash),
                "created_at": login.created_at, "created_by": people.get(login.created_by), "activated_at": login.activated_at,
                "deactivated_at": login.deactivated_at,
                "last_sign_in_at": sign_in.signed_in_at if sign_in else None, "last_sign_in_ip": sign_in.ip if sign_in else None,
                "last_sign_in_country": geoip.country_of(sign_in.ip) if sign_in else None,
            },
            "attention": attention,
        })
    return out


def _filtered_partners(db, q, country, status, login_status, attention, created_from, created_to, created_by) -> list[dict[str, Any]]:
    query = select(Partner)
    if q and q.strip():
        like = f"%{q.strip()}%"
        with_login = select(User.id).where(User.email.ilike(like))
        query = query.where(or_(Partner.name.ilike(like), Partner.contact_email.ilike(like), Partner.user_id.in_(with_login)))
    if country:
        query = query.where(Partner.country_of_operation == country)
    if status is not None:
        query = query.where(Partner.status == status)
    if created_from is not None:
        query = query.where(Partner.created_at >= _start(created_from))
    if created_to is not None:
        query = query.where(Partner.created_at < _start(created_to + timedelta(days=1)))
    if created_by:
        query = query.where(Partner.created_by == created_by)
    rows = _partner_rows(db, list(db.scalars(query.order_by(Partner.created_at.desc(), Partner.id))))
    if login_status is not None:
        rows = [r for r in rows if r["login_status"] == login_status]
    if attention is not None:
        rows = [r for r in rows if r["attention"] and r["attention"]["kind"] == attention]
    return rows


class PartnerFilters:
    """The list's filters, shared by the page and its CSV."""

    def __init__(
        self,
        q: Annotated[str | None, Query(max_length=200)] = None,
        country: Annotated[str | None, Query(max_length=200)] = None,
        status: PartnerStatus | None = None,
        login_status: LoginStatus | None = None,
        attention: Attention | None = None,
        created_from: date | None = None,
        created_to: date | None = None,
        created_by: Annotated[str | None, Query(max_length=100)] = None,
    ):
        self.args = (q, country, status, login_status, attention, created_from, created_to, created_by)
        self.audited = {
            k: (v.value if hasattr(v, "value") else str(v)) for k, v in {
                "country": country, "status": status, "login_status": login_status, "attention": attention,
                "created_from": created_from, "created_to": created_to, "created_by": created_by,
            }.items() if v is not None
        } | ({"search": True} if q else {})


@router.get("/partners", response_model=Page[PartnerLoginRow])
def list_partner_logins(
    _admin: Admin, db: DbSession, paging: Annotated[PageParams, Depends(page_params)], filters: Annotated[PartnerFilters, Depends()],
):
    """Newest agency first."""
    rows = _filtered_partners(db, *filters.args)
    return {"data": rows[paging.offset : paging.offset + paging.page_size], "total": len(rows), "page": paging.page, "pageSize": paging.page_size}


class PartnerSummary(BaseModel):
    """The overview at the top of Partners & Logins."""

    agencies: int
    agencies_by_status: dict[PartnerStatus, int]
    logins_by_status: dict[LoginStatus, int]
    # Logins needing follow-up, as the scheduled checks define them.
    attention: dict[Attention, int]
    new_agencies: Window
    # Agencies with an active login that signed in during the last 30 days.
    signed_in_last_30d: int


@router.get("/partners/summary", response_model=Data[PartnerSummary])
def partner_summary(_admin: Admin, db: DbSession):
    rows = _filtered_partners(db, *PartnerFilters().args)
    since = utc_now_ms() - timedelta(days=30)
    by_status = {s: 0 for s in PartnerStatus}
    by_login = {s: 0 for s in get_args(LoginStatus)}
    attention = {a: 0 for a in get_args(Attention)}
    for r in rows:
        by_status[r["status"]] += 1
        by_login[r["login_status"]] += 1
        if r["attention"]:
            attention[r["attention"]["kind"]] += 1
    signed_in = sum(1 for r in rows if r["login_status"] == "active" and r["login"]["last_sign_in_at"] and r["login"]["last_sign_in_at"] >= since)
    return {"data": {
        "agencies": len(rows),
        "agencies_by_status": by_status,
        "logins_by_status": by_login,
        "attention": attention,
        "new_agencies": _window(db, Partner.created_at),
        "signed_in_last_30d": signed_in,
    }}


@router.get("/partners/options", response_model=Data[PartnerOptions])
def partner_options(_admin: Admin, db: DbSession):
    """The countries agencies operate in, and who has added agencies, for the filters."""
    countries = list(db.scalars(select(Partner.country_of_operation).distinct().order_by(Partner.country_of_operation)))
    creators = db.execute(
        select(User.id, User.full_name).where(User.id.in_(select(Partner.created_by).where(Partner.created_by.is_not(None)))).order_by(User.full_name)
    ).all()
    return {"data": {"countries": countries, "creators": [{"id": c.id, "full_name": c.full_name} for c in creators]}}


CSV_HEADER = [
    "Agency", "Type", "Country", "Agency status", "MOU", "Added", "Added by", "Login email", "Login created", "Login created by",
    "Login status", "Active since", "Last sign-in",
]
LOGIN_STATUS_LABELS = {"no_login": "No login", "setup_pending": "Setup email sent", "active": "Active", "deactivated": "Deactivated"}


def _cell(value: Any) -> str:
    """One CSV cell. A value a spreadsheet would run as a formula (=, +, -,
    @, a tab or a return first) is prefixed with an apostrophe: agency names
    and emails are typed in by people."""
    text_value = "" if value is None else (value.isoformat(timespec="minutes") if isinstance(value, datetime) else str(value))
    if text_value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        text_value = "'" + text_value
    return '"' + text_value.replace('"', '""') + '"' if any(ch in text_value for ch in '",\n\r') else text_value


def _csv_line(r: dict[str, Any]) -> list[Any]:
    login = r["login"] or {}
    name = lambda person: person["full_name"] if person else ""  # noqa: E731
    return [
        r["name"], r["partner_type"].value, r["country_of_operation"], r["status"].value, r["mou_status"].value, r["created_at"],
        name(r["created_by"]), login.get("email"), login.get("created_at"), name(login.get("created_by")),
        LOGIN_STATUS_LABELS[r["login_status"]], login.get("activated_at") if r["login_status"] == "active" else None, login.get("last_sign_in_at"),
    ]


@router.get("/partners.csv", response_class=Response)
def export_partner_logins(admin: Admin, db: DbSession, filters: Annotated[PartnerFilters, Depends()]) -> Response:
    """The filtered list, every page, as CSV. Recorded on the trail first;
    if that fails, nothing leaves (503)."""
    rows = _filtered_partners(db, *filters.args)
    try:
        append_event("export", actor_id=admin.user_id, entity_type="Partner", entity_id="partners_and_logins",
                     detail={"rows": len(rows), "filters": filters.audited})
    except Exception:  # noqa: BLE001
        raise ApiError(503, "audit_unavailable", "The export couldn't be recorded, so it wasn't made.") from None
    lines = [",".join(_cell(v) for v in line) for line in [CSV_HEADER, *(_csv_line(r) for r in rows)]]
    day = utc_now_ms().date().isoformat()
    return Response("\r\n".join(lines) + "\r\n", media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="partners-and-logins-{day}.csv"'})


# --- Audit Trail (phase 4) ------------------------------------------------------------

AUDIT_PAGE_MAX = 200
# Fields every row change touches, left out of "what changed".
UNINTERESTING = frozenset({"updated_at"})


class Change(BaseModel):
    field: str
    before: Any = None
    after: Any = None


class AuditRow(BaseModel):
    id: str
    at: UtcDateTime
    actor: Person | None
    action: str
    entity_type: str
    entity_id: str
    # The record's name where it has one (a user, a partner, a candidate).
    record: str | None
    # A row change: the fields that changed. Anything else (a sign-in, an
    # export, an alert): what it recorded.
    changes: list[Change]
    detail: dict[str, Any] | None
    ip: str | None
    request_id: str | None


def _changes(action: str, before: dict | None, after: dict | None) -> list[dict[str, Any]]:
    if action in ("create", "update", "delete", "restore"):
        before, after = before or {}, after or {}
        fields = sorted((set(before) | set(after)) - UNINTERESTING)
        if action == "update" or action == "restore":
            fields = [f for f in fields if before.get(f) != after.get(f)]
        else:
            fields = [f for f in fields if (after if action == "create" else before).get(f) is not None]
        return [{"field": f, "before": before.get(f), "after": after.get(f)} for f in fields]
    return []


def _record_names(db, rows) -> dict[tuple[str, str], str]:
    wanted: dict[str, set[str]] = {"User": set(), "Partner": set(), "Candidate": set()}
    for r in rows:
        if r.entity_type in wanted:
            wanted[r.entity_type].add(r.entity_id)
        elif r.entity_id.startswith("user:"):
            wanted["User"].add(r.entity_id[5:])
        if r.actor_id:
            wanted["User"].add(r.actor_id)
    from app.models.candidate import Candidate  # noqa: PLC0415 (only here)

    names: dict[tuple[str, str], str] = {}
    for model, label in ((User, "User"), (Partner, "Partner"), (Candidate, "Candidate")):
        ids = wanted[label]
        if ids:
            column = model.full_name if hasattr(model, "full_name") else model.name
            for row_id, name in db.execute(select(model.id, column).where(model.id.in_(ids))).all():
                names[(label, row_id)] = name
    return names


@router.get("/audit", response_model=Page[AuditRow])
def audit_trail(
    admin: Admin,
    request: Request,
    db: DbSession,
    paging: Annotated[PageParams, Depends(page_params)],
    actor_id: Annotated[str | None, Query(max_length=100)] = None,
    action: Annotated[str | None, Query(max_length=100)] = None,
    entity_type: Annotated[str | None, Query(max_length=100)] = None,
    entity_id: Annotated[str | None, Query(max_length=200)] = None,
    date_from: date | None = None,
    date_to: date | None = None,
):
    """Who did what and when, newest first. entity_id also matches the
    security events about that account ("user:<id>"). The read is recorded
    first, with its filters."""
    filters = {k: v for k, v in {
        "actor_id": actor_id, "action": action, "entity_type": entity_type, "entity_id": entity_id,
        "date_from": date_from.isoformat() if date_from else None, "date_to": date_to.isoformat() if date_to else None,
    }.items() if v}
    security_event(request, "audit_trail_viewed", actor_id=admin.user_id, entity_type="AuditLog", entity_id=entity_id or "trail",
                   detail={"view": "audit_trail", "filters": filters, "page": paging.page})
    size = min(paging.page_size, AUDIT_PAGE_MAX)
    rows = db.execute(
        text("SELECT * FROM public.vertex_audit_trail(:actor, :action, :etype, :eid, :from, :to, :limit, :offset)"),
        {
            "actor": actor_id or None, "action": action or None, "etype": entity_type or None, "eid": entity_id or None,
            "from": _start(date_from) if date_from else None, "to": _start(date_to + timedelta(days=1)) if date_to else None,
            "limit": size, "offset": paging.offset,
        },
    ).all()
    total = rows[0].total if rows else 0
    names = _record_names(db, rows)
    out = []
    for r in rows:
        key = ("User", r.entity_id[5:]) if r.entity_id.startswith("user:") else (r.entity_type, r.entity_id)
        changes = _changes(r.action, r.before, r.after)
        detail = None if changes or r.action in ("create", "update", "delete", "restore") else r.after
        ip = (r.after or {}).get("ip") if isinstance(r.after, dict) else None
        actor = {"id": r.actor_id, "full_name": names.get(("User", r.actor_id), "Deleted account")} if r.actor_id else None
        out.append({
            "id": r.id, "at": r.created_at, "actor": actor, "action": r.action, "entity_type": r.entity_type, "entity_id": r.entity_id,
            "record": names.get(key), "changes": changes, "detail": detail, "ip": ip if isinstance(ip, str) else None,
            "request_id": r.request_id,
        })
    return {"data": out, "total": total, "page": paging.page, "pageSize": size}


# --- Security Overview (phase 5) ------------------------------------------------------


class Overview(BaseModel):
    open_alerts: dict[SecurityAlertSeverity, int]
    # How long alerts and sign-in history are kept (D3).
    retention_months: int
    alerts_raised: Window
    failed_sign_ins: Window
    sign_ins: Window
    accounts_deactivated: Window
    # Partner logins whose setup email is more than 7 days old, never used.
    partner_logins_not_activated: int
    # Active staff and partner logins not signed in for 60+ days (D5).
    accounts_inactive: int
    new_partners: Window
    new_partner_logins: Window
    active_sessions: int
    # Held by the per-account sign-in limit now.
    locked_accounts: int
    # Login protection: lockouts at step 4 not yet reviewed; failed sign-ins
    # in the 24 hours before the last 24 (the trend); refused reset emails.
    lockouts_needing_review: int
    failed_sign_ins_previous_24h: int
    reset_emails_refused: Window
    # The bundled country database's month, or null if the image has none.
    geoip_month: str | None
    recent_alerts: list[AlertRow]


class ChecksRun(BaseModel):
    raised: int


def _window(db, column, *where) -> dict[str, int]:
    now = utc_now_ms()
    count = lambda since: int(db.scalar(select(func.count()).where(column >= since, *where)) or 0)  # noqa: E731
    return {"last_24h": count(now - timedelta(days=1)), "last_7d": count(now - timedelta(days=7))}


@router.get("/overview", response_model=Data[Overview])
def overview(_admin: Admin, db: DbSession):
    now = utc_now_ms()
    trail = {
        label: dict(db.execute(text("SELECT action, n FROM public.vertex_monitoring_counts(:s)"), {"s": now - delta}).all())
        for label, delta in (("last_24h", timedelta(days=1)), ("last_48h", timedelta(days=2)), ("last_7d", timedelta(days=7)))
    }
    open_alerts = {s: 0 for s in SecurityAlertSeverity}
    for level, n in db.execute(
        select(SecurityAlert.severity, func.count()).where(SecurityAlert.status == SecurityAlertStatus.open).group_by(SecurityAlert.severity)
    ).all():
        open_alerts[level] = n
    sessions = db.scalar(select(func.count(func.distinct(RefreshToken.family_id))).where(
        RefreshToken.revoked_at.is_(None), RefreshToken.used_at.is_(None), RefreshToken.expires_at > now,
    ))
    recent = list(db.scalars(select(SecurityAlert).order_by(SecurityAlert.created_at.desc(), SecurityAlert.id.desc()).limit(10)))
    from_trail = lambda action: {k: int(trail[k].get(action, 0)) for k in ("last_24h", "last_7d")}  # noqa: E731
    return {"data": {
        "open_alerts": open_alerts,
        "retention_months": settings.SECURITY_RETENTION_MONTHS,
        "alerts_raised": _window(db, SecurityAlert.created_at),
        "failed_sign_ins": from_trail("login_failed"),
        "sign_ins": from_trail("login_succeeded"),
        "accounts_deactivated": _window(db, User.deactivated_at),
        "partner_logins_not_activated": len(security_monitor.overdue_setups(db)),
        "accounts_inactive": len(security_monitor.inactive_logins(db)),
        "new_partners": _window(db, Partner.created_at),
        "new_partner_logins": _window(db, User.created_at, User.role == Role.partner),
        "active_sessions": int(sessions or 0),
        "locked_accounts": len(login_lockout.held(db)),
        "lockouts_needing_review": _needing_review(db),
        "failed_sign_ins_previous_24h": int(trail["last_48h"].get("login_failed", 0)) - int(trail["last_24h"].get("login_failed", 0)),
        "reset_emails_refused": from_trail("reset_rate_limited"),
        "geoip_month": geoip.database_month(),
        "recent_alerts": _alert_rows(db, recent),
    }}


@router.post("/checks/run", response_model=Data[ChecksRun])
def run_checks(_admin: Admin):
    """The scheduled account checks, now. An account already raised this
    month isn't raised again."""
    return {"data": {"raised": security_monitor.run_account_checks()}}


# --- Locked Accounts (owner's addition, 2026-11-07) ---------------------------------


class LockedRow(BaseModel):
    # The account is known by its email's fingerprint, as the limit counts
    # it (an address typed at sign-in, which may have no account).
    email_fp: str
    lockout_id: str
    failures: int
    # 1 to 4: 15 minutes, 1 hour, 4 hours, 24 hours (login protection L1).
    step: int
    locked_at: UtcDateTime
    unlocks_in_seconds: int
    last_ip: str | None
    last_country: str | None
    # Step 4: an admin should look at it (L6).
    needs_review: bool
    account: AlertAccount | None


class Unlocked(BaseModel):
    email_fp: str
    unlocked: bool
    # "Unlock and send reset link": whether the reset email went, and if
    # not, why (no_account, no_password, deactivated, email_limited).
    reset_sent: bool = False
    reset_refused: str | None = None


class UnlockIn(BaseModel):
    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=500)]
    send_reset: bool = False


class LockedSummary(BaseModel):
    # Lockouts at step 4 not yet reviewed (the sidebar badge reads "open").
    open: int
    held: int


class LockoutReviewIn(BaseModel):
    note: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=1000)]


class ForceResetIn(BaseModel):
    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=500)]


class ForceReset(BaseModel):
    id: str
    email: str
    # The lockout it lifted, if one was holding the account.
    unlocked: bool


def _accounts_by_id(db, ids: set[str]) -> dict[str, dict[str, Any]]:
    if not ids:
        return {}
    return {
        u.id: {"id": u.id, "full_name": u.full_name, "email": u.email, "role": u.role, "deactivated": u.deactivated_at is not None}
        for u in db.scalars(select(User).where(User.id.in_(ids)))
    }


def _lockout_rows(db, rows: list[LoginLockout]) -> list[dict[str, Any]]:
    ids = {r.user_id for r in rows} | {r.ended_by_user_id for r in rows} | {r.reviewed_by for r in rows}
    ids.discard(None)
    accounts = _accounts_by_id(db, ids)
    person = lambda i: {"id": i, "full_name": accounts[i]["full_name"]} if i in accounts else None  # noqa: E731
    now = utc_now_ms()
    return [{
        "id": r.id, "email_fp": r.email_fp, "account": accounts.get(r.user_id) if r.user_id else None, "step": r.step,
        "locked_at": r.locked_at, "locked_until": r.locked_until, "failures": r.failures, "last_ip": r.last_ip,
        "last_country": r.last_country, "holding": r.ended_at is None and r.locked_until > now, "ended_at": r.ended_at,
        "ended_by": r.ended_by, "ended_by_person": person(r.ended_by_user_id), "end_reason": r.end_reason,
        "needs_review": r.needs_review, "reviewed_at": r.reviewed_at, "reviewed_by": person(r.reviewed_by), "review_note": r.review_note,
    } for r in rows]


def _needing_review(db) -> int:
    return int(db.scalar(select(func.count()).select_from(LoginLockout).where(
        LoginLockout.needs_review.is_(True), LoginLockout.reviewed_at.is_(None),
    )) or 0)


def _check_fp(email_fp: str) -> None:
    if not (8 <= len(email_fp) <= 64 and all(c in "0123456789abcdef" for c in email_fp)):
        raise ApiError(422, "validation_error", "Validation failed", {"email_fp": ["Not an email fingerprint."]})


@router.get("/locked", response_model=Data[list[LockedRow]])
def locked(_admin: Admin, db: DbSession):
    """Addresses held now after too many failed sign-ins, longest to go
    first (app/services/login_lockout.py)."""
    held = login_lockout.held(db)
    accounts = _accounts_by_id(db, {row.user_id for row in held if row.user_id})
    return {"data": [
        {"email_fp": row.email_fp, "lockout_id": row.id, "failures": row.failures, "step": row.step, "locked_at": row.locked_at,
         "unlocks_in_seconds": login_lockout.seconds_left(row), "last_ip": row.last_ip, "last_country": row.last_country,
         "needs_review": row.needs_review and row.reviewed_at is None,
         "account": accounts.get(row.user_id) if row.user_id else None}
        for row in held
    ]}


@router.get("/locked/summary", response_model=Data[LockedSummary])
def locked_summary(_admin: Admin, db: DbSession):
    """For the sidebar badge: lockouts needing review, and how many hold now."""
    return {"data": {"open": _needing_review(db), "held": len(login_lockout.held(db))}}


@router.post("/locked/{email_fp}/unlock", response_model=Data[Unlocked])
def unlock(email_fp: str, body: UnlockIn, admin: Admin, request: Request, db: AuditedDb):
    """Lifts the lock at once, with a reason, and starts the escalation
    again (the next lockout is 15 minutes). Recorded on the lockout (who,
    why) and as login_unlocked; the failures stay on the trail. With
    send_reset, the account's owner also gets a password reset email (the
    per-email limit applies)."""
    _check_fp(email_fp)
    lifted = login_lockout.end(db, email_fp, LockoutEnd.admin, by=admin.user_id, reason=body.reason)
    user_id = lifted.user_id if lifted else None
    db.commit()
    reset_sent, refused = False, None
    notify: list = []
    if body.send_reset:
        user = db.get(User, user_id) if user_id else None
        if user is None:
            refused = "no_account"
        elif not user.password_hash:
            refused = "no_password"
        elif user.deactivated_at is not None:
            refused = "deactivated"
        elif not account_email_allowed(request, user.email, user_id=user.id, kind="password_reset", actor_id=admin.user_id):
            refused = "email_limited"
        else:
            notify.append(PasswordResetEmail(email=user.email, full_name=user.full_name, token=sign_reset_token(user.id, user.email, user.password_hash)))
            reset_sent = True
    security_event(request, "login_unlocked", actor_id=admin.user_id, entity_type="Auth",
                   entity_id=f"user:{user_id}" if user_id else f"email_fp:{email_fp}",
                   detail={"email_fp": email_fp, "was_locked": lifted is not None, "reason": body.reason,
                           "step": lifted.step if lifted else None, "reset_sent": reset_sent} | ({"reset_refused": refused} if refused else {}))
    deliver(db, notify)
    return {"data": {"email_fp": email_fp, "unlocked": lifted is not None, "reset_sent": reset_sent, "reset_refused": refused}}


@router.get("/lockouts", response_model=Page[LockoutRow])
def lockout_history(
    _admin: Admin,
    db: DbSession,
    paging: Annotated[PageParams, Depends(page_params)],
    q: Annotated[str | None, Query(max_length=200)] = None,
    step: Annotated[int | None, Query(ge=1, le=4)] = None,
    # How it ended; "holding" for one still holding the address.
    ended_by: Literal["expired", "admin", "password_reset", "holding"] | None = None,
    needs_review: bool | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
):
    """Every lockout within the retention window (D3), newest first."""
    now = utc_now_ms()
    query = select(LoginLockout).where(LoginLockout.locked_at >= security_monitor.retention_cutoff())
    if q and q.strip():
        like = f"%{q.strip()}%"
        query = query.where(LoginLockout.user_id.in_(select(User.id).where(or_(User.full_name.ilike(like), User.email.ilike(like)))))
    if step is not None:
        query = query.where(LoginLockout.step == step)
    if ended_by == "holding":
        query = query.where(LoginLockout.ended_at.is_(None), LoginLockout.locked_until > now)
    elif ended_by == "expired":
        # Closed as expired, or past its time and not yet swept.
        query = query.where(or_(LoginLockout.ended_by == LockoutEnd.expired,
                                (LoginLockout.ended_at.is_(None)) & (LoginLockout.locked_until <= now)))
    elif ended_by is not None:
        query = query.where(LoginLockout.ended_by == LockoutEnd(ended_by))
    if needs_review is True:
        query = query.where(LoginLockout.needs_review.is_(True), LoginLockout.reviewed_at.is_(None))
    elif needs_review is False:
        query = query.where(or_(LoginLockout.needs_review.is_(False), LoginLockout.reviewed_at.is_not(None)))
    if date_from is not None:
        query = query.where(LoginLockout.locked_at >= _start(date_from))
    if date_to is not None:
        query = query.where(LoginLockout.locked_at < _start(date_to + timedelta(days=1)))
    total = int(db.scalar(select(func.count()).select_from(query.subquery())) or 0)
    rows = list(db.scalars(query.order_by(LoginLockout.locked_at.desc(), LoginLockout.id).offset(paging.offset).limit(paging.page_size)))
    return {"data": _lockout_rows(db, rows), "total": total, "page": paging.page, "pageSize": paging.page_size}


@router.post("/lockouts/{lockout_id}/review", response_model=Data[LockoutRow])
def review_lockout(lockout_id: str, body: LockoutReviewIn, admin: Admin, db: AuditedDb):
    """Closes "Needs review" on a step-4 lockout, with a note (audited)."""
    row = db.scalar(select(LoginLockout).where(LoginLockout.id == lockout_id).with_for_update())
    if row is None:
        raise ApiError(404, "not_found", "Lockout not found.")
    if not row.needs_review:
        raise ApiError(409, "not_flagged", "This lockout isn't flagged for review.")
    if row.reviewed_at is not None:
        raise ApiError(409, "already_reviewed", "This lockout has been reviewed already.")
    row.reviewed_at, row.reviewed_by, row.review_note = utc_now_ms(), admin.user_id, body.note
    db.commit()
    return {"data": _lockout_rows(db, [row])[0]}


@router.post("/accounts/{user_id}/force-reset", response_model=Notifying[ForceReset])
def force_password_reset(user_id: str, body: ForceResetIn, admin: Admin, request: Request, db: AuditedDb):
    """Clears a staff or partner login's password, so it stops working at
    once and every session ends (the token_version trigger), lifts any
    lockout, and sends the setup email. Refused before anything changes if
    the address has had its account emails for now. Candidates reset with
    the reset link instead ("Unlock and send reset link")."""
    user = db.scalar(select(User).where(User.id == user_id).with_for_update())
    if user is None:
        raise ApiError(404, "not_found", "Account not found.")
    if user.role is Role.candidate:
        raise ApiError(422, "candidate", "Candidates reset their password with the reset link: use Unlock and send reset link.")
    if user.id == admin.user_id:
        raise ApiError(422, "own_account", "You can't force a reset of your own account.")
    if user.deactivated_at is not None:
        raise ApiError(409, "account_deactivated", "This account is deactivated; reactivate it first.")
    if not account_email_allowed(request, user.email, user_id=user.id, kind="account_setup", actor_id=admin.user_id):
        raise ApiError(429, "email_limited", EMAIL_LIMITED)
    user.password_hash = None
    lifted = login_lockout.end(db, email_fingerprint(user.email), LockoutEnd.admin, by=admin.user_id, reason=body.reason)
    db.commit()
    security_event(request, "password_force_reset", actor_id=admin.user_id, entity_type="User", entity_id=user.id,
                   detail={"reason": body.reason, "role": user.role.value, "unlocked": lifted is not None})
    notify = [AccountSetupEmail(email=user.email, full_name=user.full_name, token=sign_account_setup_token(user.id))]
    return {"data": {"id": user.id, "email": user.email, "unlocked": lifted is not None}, "notify": deliver(db, notify)}
