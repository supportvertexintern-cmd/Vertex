"""The candidate pipeline, read, part 2 (reads handover R5): cases, a case's
contract and history, exceptions, rejected submissions, and a document's
download link. They answer as the website's routes read them through
Prisma, which now ask here instead: the same roles, scopes, filters,
sorting and JSON keys (app/api/shapes.py). The writes are in cases.py,
exceptions.py and documents.py.

The audit trail stays unreadable to vertex_api (Phase 10). A case's history
and the rejection dates come from the functions in migration 0008 (owner's
decision 2026-11-02), which return no before/after snapshots.

Differences, all deliberate: an unknown stage, source, status, escalation
level or category is a 422 instead of the 500 it caused; ties in a sort
are broken by id, so pages are stable.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from sqlalchemy import ColumnElement, func, or_, select, text
from sqlalchemy.orm import Session

from app.api.deps import DbSession
from app.api.shapes import full, ordered, pick, value
from app.api.v1.pipeline_reads import NAME, PERSON, _enum, _ilike, _opportunity, _paging
from app.core.api import ApiError
from app.core.audit import record_security_event
from app.core.auth import AuthUser, CurrentUser, calling_service
from app.core.rbac import HR_ROLES, STAFF_ROLES, require_role
from app.core.scope import CandidateRef, can_access_case, can_access_document, case_scope, inhouse_country_ids
from app.models.candidate import Application, Candidate, Document
from app.models.cases import Case
from app.models.enums import (
    CandidateLifecycleStatus,
    CandidateSource,
    CaseStage,
    CaseStatus,
    EscalationLevel,
    ExceptionCategory,
    ExceptionStatus,
    PartnerCandidateStatus,
    Role,
)
from app.models.identity import User
from app.models.jobs import Job
from app.models.partners import Partner, PartnerCandidate
from app.models.reporting import ExceptionReport
from app.services.opportunity_filters import resolve

router = APIRouter()

CASE_READERS = (
    Role.candidate, Role.regional_recruiter, Role.country_supervisor, Role.inhouse_supervisor, Role.director, Role.admin,
    Role.partner, Role.hr, Role.operations_team, Role.operations_director, Role.finance,
)
REJECTED_READERS = tuple(r for r in CASE_READERS if r not in (Role.candidate, Role.partner))
# Partner submissions as HR's queue has them (Q2), self submissions HR's.
PARTNER_SUBMISSION_READERS = (*HR_ROLES, Role.operations_team, Role.operations_director)

CaseReader = Annotated[AuthUser, Depends(require_role(*CASE_READERS))]
RejectedReader = Annotated[AuthUser, Depends(require_role(*REJECTED_READERS))]
ExceptionReader = Annotated[AuthUser, Depends(require_role(*STAFF_ROLES))]

# A summary per entity and action, for the case history.
TRAIL_LABELS = {
    "Case:create": "Case opened",
    "Case:update": "Case updated",
    "CaseStageEvent:create": "Stage advanced",
    "CaseStageEvent:update": "Stage event updated",
    "Contract:create": "Contract issued",
    "Contract:update": "Contract updated",
    "CasePayment:create": "Payment recorded",
    "CasePayment:update": "Payment updated",
    "RetentionFollowUp:create": "Retention follow-up started",
    "RetentionFollowUp:update": "Retention follow-up updated",
}


def _case(db: Session, user: AuthUser, case_id: str, missing: str) -> Case:
    c = db.get(Case, case_id)
    if c is None:
        raise ApiError(404, "not_found", missing)
    if not can_access_case(db, user, CandidateRef.of(c.application.candidate)):
        raise ApiError(403, "forbidden", "Forbidden.")
    return c


# --- cases ---------------------------------------------------------------------------


def _list_case(c: Case) -> dict[str, Any]:
    return full(
        c,
        application=lambda a: full(
            a,
            candidate=lambda k: full(k, user=PERSON, country=full, recruiter=lambda u: pick(u, "full_name"), partner=NAME),
            job=lambda j: pick(j, "title", "country", "city"), preferred_country_1=NAME, preferred_sector=NAME,
        ),
        contract=lambda k: pick(k, "status"),
        retention_follow_up=lambda r: pick(r, "due_at", "completed_at"),
        payments=lambda p: pick(p, "status", "sent_to_email"),
    )


@router.get("/cases")
def list_cases(
    db: DbSession, user: CaseReader,
    stage: str | None = None, country_id: str | None = None, candidate_id: str | None = None, q: str | None = None,
    partner_id: str | None = None, source: str | None = None, country: str | None = None, programme: str | None = None,
    programmeCountry: str | None = None, filterOptions: str | None = None, status: str | None = None,  # noqa: N803
    page: str | None = None, pageSize: str | None = None, sortBy: str | None = None, sortDir: str | None = None,  # noqa: N803
) -> dict[str, Any]:
    """The caller's cases (case_scope), active ones unless status is "all"
    or "rejected", filtered, searched, sorted and paged, optionally with the
    opportunity filter options."""
    opp = _opportunity({"country": country, "programme": programme, "programmeCountry": programmeCountry})
    wants_options = filterOptions == "true"
    options = job_filter = None
    if wants_options or opp.any:
        options, job_filter = resolve(db, Job.id.in_(select(Application.job_id).join(Case, Case.application_id == Application.id)), opp)

    by_candidate = lambda clause: Case.application.has(Application.candidate.has(clause))  # noqa: E731
    where: list[ColumnElement[bool]] = [case_scope(db, user)]
    if status != "all":
        where.append(Case.status == (CaseStatus.rejected if status == "rejected" else CaseStatus.active))
    if stage:
        where.append(Case.current_stage == _enum(CaseStage, stage, "stage"))
    if country_id:
        where.append(by_candidate(Candidate.country_id == country_id))
    if candidate_id:
        where.append(Case.application.has(Application.candidate_id == candidate_id))
    if partner_id:
        where.append(by_candidate(Candidate.partner_id == partner_id))
    if source:
        where.append(by_candidate(Candidate.source == _enum(CandidateSource, source, "source")))
    if job_filter is not None:
        where.append(Case.application.has(Application.job.has(job_filter)))
    if q:
        where.append(Case.application.has(or_(
            Application.candidate.has(or_(
                _ilike(Candidate.full_name, q),
                Candidate.user.has(or_(_ilike(User.full_name, q), _ilike(User.email, q))),
                Candidate.partner.has(_ilike(Partner.name, q)),
            )),
            Application.job.has(_ilike(Job.title, q)),
        )))

    page_n, size = _paging(page, pageSize, 50, 200)
    key = {"created_at": Case.created_at, "current_stage": Case.current_stage}.get(sortBy or "", Case.updated_at)
    asc = sortDir == "asc"
    total = db.scalar(select(func.count()).select_from(Case).where(*where)) or 0
    rows = db.scalars(select(Case).where(*where)
                      .order_by(key.asc() if asc else key.desc(), Case.id.asc() if asc else Case.id.desc())
                      .offset((page_n - 1) * size).limit(size))
    body: dict[str, Any] = {"data": [_list_case(c) for c in rows], "total": total, "page": page_n, "pageSize": size}
    if wants_options and options is not None:
        body["filter_options"] = options
    return body


@router.get("/cases/{case_id}")
def get_case(case_id: str, db: DbSession, user: CaseReader) -> dict[str, Any]:
    """A case the caller may see: its candidate and documents, stage
    history, contract, payments and retention follow-up."""
    c = _case(db, user, case_id, "Case not found.")
    by_name = lambda u: pick(u, "full_name")  # noqa: E731
    return {"data": full(
        c,
        application=lambda a: full(
            a,
            candidate=lambda k: full(
                k, user=PERSON, country=full, recruiter=lambda u: pick(u, "id", "full_name"), partner=NAME,
                documents=ordered(full, "uploaded_at", desc=True),
            ),
            job=lambda j: full(j, payment_stages=ordered(full, "order")),
            job_position=lambda p: pick(p, job_sector=lambda s: pick(s, "sector")),
            preferred_country_1=NAME, preferred_sector=NAME,
        ),
        stage_events=ordered(lambda e: full(e, owner=by_name), "entered_at"),
        contract=full,
        payments=ordered(lambda p: full(p, recorder=by_name), "recorded_at", desc=True),
        retention_follow_up=full,
        ops_reviewed_by=by_name,
        rejected_by=by_name,
    )}


@router.get("/cases/{case_id}/contract")
def get_contract(case_id: str, db: DbSession, user: CurrentUser) -> dict[str, Any]:
    """The case's contract, for anyone who may see the case."""
    c = _case(db, user, case_id, "Case not found.")
    if c.contract is None:
        raise ApiError(404, "not_found", "No contract yet.")
    return {"data": full(c.contract)}


@router.get("/cases/{case_id}/audit-log")
def case_history(case_id: str, db: DbSession, user: CaseReader) -> dict[str, Any]:
    """A case's history, oldest first: what the audit trail recorded on the
    case and its stage events, contract, payments and retention follow-up
    (vertex_case_trail, without the snapshots), and the reminders sent."""
    c = _case(db, user, case_id, "Case not found.")
    trail = db.execute(text("SELECT id, entity_type, action, actor_id, created_at FROM public.vertex_case_trail(:case_id)"), {"case_id": c.id}).all()
    actor_ids = {t.actor_id for t in trail if t.actor_id}
    actors = {u.id: u for u in db.scalars(select(User).where(User.id.in_(actor_ids)))} if actor_ids else {}
    entries: list[dict[str, Any]] = []
    for t in trail:
        actor = actors.get(t.actor_id) if t.actor_id else None
        entries.append({
            "id": t.id, "kind": "audit", "summary": TRAIL_LABELS.get(f"{t.entity_type}:{t.action}", f"{t.entity_type} {t.action}"),
            "actorName": actor.full_name if actor else "System", "actorRole": value(actor.role) if actor else None, "at": t.created_at,
        })
    for r in c.reminders:
        note = f': "{r.message}"' if r.message else ""
        entries.append({
            "id": r.id, "kind": "reminder", "summary": f"Reminder sent ({value(r.channel)}) to {r.recipient}{note}",
            "actorName": r.sender.full_name, "actorRole": value(r.sender.role), "at": r.sent_at,
        })
    # Stable, as the website's sort was: audit rows before reminders at the same time.
    entries.sort(key=lambda e: e["at"])
    return {"data": [{k: v for k, v in e.items() if k != "at"} | {"timestamp": value(e["at"])} for e in entries]}


# --- exceptions ------------------------------------------------------------------------


@router.get("/exceptions")
def list_exceptions(
    db: DbSession, user: ExceptionReader,
    status: str | None = None, escalation_level: str | None = None, category: str | None = None, q: str | None = None,
    page: str | None = None, pageSize: str | None = None,  # noqa: N803
) -> dict[str, Any]:
    """Exceptions, newest first: a recruiter's own; a country or in-house
    supervisor's own and their countries'; everything for director and
    admin. Filtered, searched and paged."""
    match user.role:
        case Role.regional_recruiter:
            scope: ColumnElement[bool] = ExceptionReport.raised_by == user.user_id
        case Role.country_supervisor | Role.inhouse_supervisor:
            if user.role is Role.country_supervisor:
                assigned = db.scalar(select(User.assigned_country_id).where(User.id == user.user_id))
                countries = [assigned] if assigned else []
            else:
                countries = inhouse_country_ids(db, user.user_id)
            own = ExceptionReport.raised_by == user.user_id
            scope = or_(own, ExceptionReport.country_id.in_(countries)) if countries else own
        case _:
            scope = ExceptionReport.id.is_not(None)  # director, admin

    where: list[ColumnElement[bool]] = [scope]
    if status:
        where.append(ExceptionReport.status == _enum(ExceptionStatus, status, "status"))
    if escalation_level:
        where.append(ExceptionReport.escalation_level == _enum(EscalationLevel, escalation_level, "escalation level"))
    if category:
        where.append(ExceptionReport.category == _enum(ExceptionCategory, category, "category"))
    term = (q or "").strip()
    if term:
        where.append(or_(
            _ilike(ExceptionReport.reference, term), _ilike(ExceptionReport.issue_statement, term),
            ExceptionReport.candidate.has(_ilike(Candidate.full_name, term)),
        ))

    page_n, size = _paging(page, pageSize, 15, 100)
    total = db.scalar(select(func.count()).select_from(ExceptionReport).where(*where)) or 0
    rows = db.scalars(select(ExceptionReport).where(*where).order_by(ExceptionReport.created_at.desc(), ExceptionReport.id.desc())
                      .offset((page_n - 1) * size).limit(size))
    ref = lambda u: pick(u, "id", "full_name")  # noqa: E731
    shape = lambda e: pick(  # noqa: E731
        e, "id", "reference", "category", "role_at_raise", "reference_note", "issue_statement", "immediate_impact",
        "decision_required", "decision_deadline", "escalation_level", "status", "decision", "decision_notes", "decided_at", "created_at",
        raiser=lambda u: pick(u, "id", "full_name", "role"), country=lambda k: pick(k, "id", "name"),
        candidate=ref, decider=ref,
        corrective_actions=lambda a: pick(a, "id", "action", "due_date", "success_measure", "status", "evidence", owner=ref),
    )
    return {"data": [shape(e) for e in rows], "total": total, "page": page_n, "pageSize": size}


# --- rejected submissions ------------------------------------------------------------------


def _rejection_dates(db: Session, entity_type: str, ids: list[str]) -> dict[str, datetime]:
    if not ids:
        return {}
    rows = db.execute(text("SELECT entity_id, rejected_at FROM public.vertex_rejection_dates(:t, :ids)"), {"t": entity_type, "ids": ids})
    return {r.entity_id: r.rejected_at for r in rows}


def _first(*values: Any) -> Any:
    """JavaScript's a ?? b ?? c."""
    return next((v for v in values if v is not None), None)


def _in_brackets(title: str, country: str) -> str:
    return f"{title} ({country})"


def _preferred(a: Application | None) -> str | None:
    if a is None:
        return None
    parts = [a.preferred_sector.name if a.preferred_sector else None, a.preferred_country_1.name if a.preferred_country_1 else None]
    return " / ".join(p for p in parts if p) or None


@router.get("/rejected-submissions")
def rejected_submissions(db: DbSession, user: RejectedReader) -> dict[str, Any]:
    """Everything rejected the caller may see, newest rejection first:
    cases in their scope; partner submissions for HR and operations; self
    submissions for HR, unless a rejected case already shows them."""
    cases = list(db.scalars(select(Case).where(case_scope(db, user), Case.status == CaseStatus.rejected)))
    partner_rows = list(db.scalars(select(PartnerCandidate).where(PartnerCandidate.status == PartnerCandidateStatus.rejected))) \
        if user.role in PARTNER_SUBMISSION_READERS else []
    self_rows = list(db.scalars(select(Candidate).where(
        Candidate.lifecycle_status == CandidateLifecycleStatus.rejected,
        Candidate.source.in_((CandidateSource.self_registered, CandidateSource.referral_sourced)),
    ))) if user.role in HR_ROLES else []
    partner_dates = _rejection_dates(db, "PartnerCandidate", [p.id for p in partner_rows])
    self_dates = _rejection_dates(db, "Candidate", [c.id for c in self_rows])
    with_case = {c.application.candidate_id for c in cases}

    rows: list[dict[str, Any]] = []
    for p in partner_rows:
        rows.append({
            "id": p.id, "type": "Partner submission", "name": _first(p.full_name, "Unnamed candidate"), "partner": p.partner.name,
            "opportunity": _in_brackets(p.job.title, p.job.country) if p.job else None,
            "rejected_at": _first(partner_dates.get(p.id), p.updated_at), "reason": p.rejection_reason, "status": value(p.status),
        })
    for c in self_rows:
        if c.id in with_case:
            continue
        latest = max(c.applications, key=lambda a: a.submitted_at, default=None)
        rows.append({
            "id": c.id, "type": "Self submission", "name": _first(c.user.full_name if c.user else None, c.full_name, "Unnamed candidate"),
            "partner": None,
            "opportunity": _in_brackets(latest.job.title, latest.job.country) if latest and latest.job else _preferred(latest),
            "rejected_at": _first(self_dates.get(c.id), c.updated_at), "reason": c.return_reason, "status": value(c.lifecycle_status),
        })
    for k in cases:
        a, cand = k.application, k.application.candidate
        rows.append({
            "id": k.id, "type": "Case", "name": _first(cand.user.full_name if cand.user else None, cand.full_name, "Unnamed candidate"),
            "partner": cand.partner.name if cand.partner else None,
            "opportunity": _in_brackets(a.job_position.title if a.job_position else a.job.title, a.job.country) if a.job else _preferred(a),
            "rejected_at": _first(k.rejected_at, k.updated_at), "reason": k.rejection_reason, "status": value(k.status),
        })
    rows.sort(key=lambda r: r["rejected_at"], reverse=True)
    return {"data": [r | {"rejected_at": value(r["rejected_at"])} for r in rows]}


# --- a document's download link --------------------------------------------------------------


@router.get("/documents/{document_id}/link", dependencies=[Depends(calling_service)])
def document_link(document_id: str, db: DbSession, user: CurrentUser) -> dict[str, Any]:
    """The website asks before it signs a short-lived download link for a
    signed-in user: may they see this document (can_access_document)? The
    answer is the file's storage key, for the website alone, which holds
    the link key; the issue is on the audit trail."""
    d = db.get(Document, document_id)
    if d is None:
        raise ApiError(404, "not_found", "Document not found.")
    candidate = CandidateRef.of(d.candidate) if d.candidate else None
    if not can_access_document(db, user, candidate, d.partner_candidate_id):
        raise ApiError(403, "forbidden", "Forbidden.")
    record_security_event(
        "document_link_issued", actor_id=user.user_id, entity_type="Document", entity_id=d.id,
        detail={"type": value(d.type), "candidate_id": d.candidate_id},
    )
    return {"data": {"storage_path": d.storage_path}}
