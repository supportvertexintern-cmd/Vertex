"""Payments and users, read (reads handover R6): a case's payments, a
user's own payments, the paid consultation bookings, Finance's payments-due
worklist and the staff directory. They answer as the website's routes read
them through Prisma, which now ask here instead: the same roles, scopes,
order and JSON keys (app/api/shapes.py). The writes are in
case_payments.py, payments.py and users.py.

Differences, all deliberate: an unknown role in the directory is a 422
instead of the 500 it caused; ties in an order are broken by id.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends
from sqlalchemy import ColumnElement, or_, select
from sqlalchemy.orm import Session

from app.api.deps import DbSession
from app.api.shapes import full, pick, value
from app.api.v1.case_reads import _case
from app.api.v1.pipeline_reads import _enum, _ilike
from app.core.auth import AuthUser, CurrentUser
from app.core.rbac import FINANCE_ROLES, OPERATIONS_ROLES, require_role
from app.models.cases import Case, CasePayment, FeePolicy
from app.models.enums import CasePaymentStatus, Role
from app.models.identity import User
from app.models.payments import ConsultationBooking, Payment
from app.services.case_lifecycle import CASE_STAGE_ORDER
from app.services.stripe_pricing import payment_stage_amounts

router = APIRouter()

# Every staff tier and the sourcing partner may see a case's payments; only
# recording one is Finance's (director and admin override, 2026-07-31).
PAYMENT_READERS = (
    Role.regional_recruiter, Role.country_supervisor, Role.inhouse_supervisor, Role.director, Role.admin, Role.hr,
    Role.operations_team, Role.operations_director, Role.finance, Role.partner,
)
# The roles the directory lists when no role or search narrows it.
DIRECTORY_STAFF = (
    Role.regional_recruiter, Role.country_supervisor, Role.inhouse_supervisor, Role.director, Role.marketing, Role.hr,
    Role.operations_team, Role.operations_director, Role.finance, Role.admin,
)

PaymentReader = Annotated[AuthUser, Depends(require_role(*PAYMENT_READERS))]
BookingReader = Annotated[AuthUser, Depends(require_role(*(OPERATIONS_ROLES | FINANCE_ROLES)))]
FinanceUser = Annotated[AuthUser, Depends(require_role(*FINANCE_ROLES))]
DirectoryReader = Annotated[AuthUser, Depends(require_role(Role.admin, Role.director))]


@router.get("/cases/{case_id}/payments")
def case_payments(case_id: str, db: DbSession, user: PaymentReader) -> dict[str, Any]:
    """A case's payments, newest first, for anyone who may see the case."""
    c = _case(db, user, case_id, "Case not found.")
    rows = db.scalars(select(CasePayment).where(CasePayment.case_id == c.id).order_by(CasePayment.recorded_at.desc(), CasePayment.id.desc()))
    return {"data": [full(p) for p in rows]}


@router.get("/payments/me")
def own_payments(db: DbSession, user: CurrentUser) -> dict[str, Any]:
    """The signed-in user's own payments, newest first."""
    rows = db.scalars(select(Payment).where(Payment.user_id == user.user_id).order_by(Payment.created_at.desc(), Payment.id.desc()))
    return {"data": [full(p, job=lambda j: pick(j, "title")) for p in rows]}


@router.get("/consultation-bookings")
def consultation_bookings(db: DbSession, _user: BookingReader) -> dict[str, Any]:
    """Every paid consultation booking, newest first, for Operations and
    Finance to reconcile the Stripe charges."""
    rows = db.scalars(select(ConsultationBooking).order_by(ConsultationBooking.created_at.desc(), ConsultationBooking.id.desc()))
    return {"data": [full(b) for b in rows]}


def _fee_policy_on(policies: list[FeePolicy], country_id: str | None) -> bool:
    """The candidate's country's policy, else the global one, else off."""
    by_country: dict[str | None, FeePolicy] = {}
    for p in policies:
        by_country.setdefault(p.country_id, p)
    policy = (by_country.get(country_id) if country_id else None) or by_country.get(None)
    return bool(policy and policy.enabled)


def _due(db: Session) -> list[dict[str, Any]]:
    policies = list(db.scalars(select(FeePolicy)))
    out: list[dict[str, Any]] = []
    for c in db.scalars(select(Case).order_by(Case.updated_at.desc(), Case.id.desc())):
        job, candidate = c.application.job, c.application.candidate
        if job is None or not job.service_fee_gbp or not job.payment_stages:
            continue
        if not _fee_policy_on(policies, candidate.country_id):
            continue
        stages = sorted(job.payment_stages, key=lambda s: s.order)
        collected = {p.job_payment_stage_id for p in c.payments if p.status is CasePaymentStatus.collected}
        amounts = payment_stage_amounts(job.service_fee_gbp, [s.percent for s in stages])
        name = next((n for n in (candidate.user.full_name if candidate.user else None, candidate.full_name) if n is not None), "— unnamed —")
        for stage, amount in zip(stages, amounts, strict=True):
            # A stage is payable once the case reaches its trigger stage.
            due = CASE_STAGE_ORDER.index(c.current_stage) >= CASE_STAGE_ORDER.index(stage.trigger_stage)
            if stage.id in collected or amount <= 0 or not due:
                continue
            out.append({
                "case_id": c.id, "candidateName": name, "partnerName": candidate.partner.name if candidate.partner else None,
                "source": value(candidate.source), "programmeTitle": job.title, "job_payment_stage_id": stage.id,
                "label": stage.label, "amountDue": amount, "currentStage": value(c.current_stage),
            })
    return out


@router.get("/finance/payments-due")
def payments_due(db: DbSession, _user: FinanceUser) -> dict[str, Any]:
    """Finance's worklist: each payment stage that is due (the case reached
    its trigger stage, the fee policy is on) and not yet collected, for
    every case on a job with a fee and payment stages."""
    return {"data": _due(db)}


@router.get("/users")
def directory(db: DbSession, _user: DirectoryReader, role: str | None = None, q: str | None = None) -> dict[str, Any]:
    """The staff directory, by name: staff roles by default; a search (q)
    covers every user, candidates included, so an admin can find one to
    promote; a role always narrows to that role."""
    where: list[ColumnElement[bool]] = []
    if role:
        where.append(User.role == _enum(Role, role, "role"))
    elif not q:
        where.append(User.role.in_(DIRECTORY_STAFF))
    if q:
        where.append(or_(_ilike(User.full_name, q), _ilike(User.email, q)))
    ref = lambda k: pick(k, "id", "name")  # noqa: E731
    rows = db.scalars(select(User).where(*where).order_by(User.full_name, User.id))
    return {"data": [
        pick(u, "id", "full_name", "email", "role", "supervisor_id", "assigned_country_id", "created_at",
             supervisor=lambda s: pick(s, "id", "full_name"), assigned_country=ref)
        | {"assigned_countries": [ref(a.country) for a in u.inhouse_country_assignments]}
        for u in rows
    ]}
