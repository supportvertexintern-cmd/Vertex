"""The candidate pipeline, read (reads handover R4): candidates,
applications, a partner's own submissions and HR's partner-submission
queue. They answer as the website's routes read them through Prisma, which
now ask here instead: the same roles, scopes, filters, sorting, summaries
and JSON keys (app/api/shapes.py). The writes are in candidates.py,
applications.py and partner_submissions.py.

Owner's decisions of 2026-11-02: HR and operations see every partner
submission (policy Q2, as the 2026-07-31 separation-of-duties decision
has them global); an in-house supervisor opens an application only in
their own countries (policy Q3), as on every other candidate view.

Differences, all deliberate: an unknown status or source is a 422 instead
of the 500 it caused; ties in a sort are broken by id, so pages are stable.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import ColumnElement, and_, func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import DbSession
from app.api.shapes import full, ordered, pick
from app.api.v1.candidates import _thread_access
from app.core.api import ApiError, js_date
from app.core.auth import AuthUser, CurrentUser
from app.core.rbac import HR_ROLES, STAFF_ROLES, require_role
from app.core.scope import CandidateRef, can_access_candidate, candidate_scope, inhouse_country_ids
from app.models.candidate import Application, Candidate, CandidateMessage, Document
from app.models.enums import CandidateLifecycleStatus, CandidateSource, VerificationStatus, PartnerCandidateStatus, Role
from app.models.identity import Country, User
from app.models.jobs import Job
from app.models.partners import Partner, PartnerCandidate
from app.services.documents import document_completeness, required_types_by_country
from app.services.opportunity_filters import OpportunityParams, resolve
from app.services.screening import evaluate_screening_gate

router = APIRouter()

# The staff candidate list and detail: the recruiter hierarchy and HR.
CANDIDATE_READERS = (Role.regional_recruiter, Role.country_supervisor, Role.inhouse_supervisor, Role.director, Role.admin, Role.hr)
# HR's partner-submission queue, and operations (Q2: global).
SUBMISSION_READERS = (*HR_ROLES, Role.operations_team, Role.operations_director)

CandidateReader = Annotated[AuthUser, Depends(require_role(*CANDIDATE_READERS))]
SubmissionReader = Annotated[AuthUser, Depends(require_role(*SUBMISSION_READERS))]
PartnerUser = Annotated[AuthUser, Depends(require_role(Role.partner))]


# --- helpers -------------------------------------------------------------------


def _int(value: str | None, default: int) -> int:
    try:
        return int(value) if value else default
    except ValueError:
        return default


def _paging(page: str | None, size: str | None, default: int, most: int) -> tuple[int, int]:
    return max(1, _int(page, 1)), min(most, max(1, _int(size, default)))


def _enum(kind: Any, raw: str, what: str) -> Any:
    try:
        return kind(raw)
    except ValueError:
        raise ApiError(422, "validation_error", f"Unknown {what}: {raw}") from None


def _date(raw: str) -> datetime:
    try:
        return js_date(raw)
    except ValueError:
        raise ApiError(422, "validation_error", "Invalid date.") from None


def _ilike(column: Any, q: str) -> ColumnElement[bool]:
    return column.icontains(q, autoescape=True)


def _opportunity(period_params: dict[str, str | None]) -> OpportunityParams:
    clean = {k: (v or "").strip() or None for k, v in period_params.items()}
    return OpportunityParams(country=clean["country"], programme=clean["programme"], programme_country=clean["programmeCountry"])


def signals(db: Session, candidate_id: str, external_role: Role) -> dict[str, Any]:
    """candidateSignals.ts: documents nobody has reviewed, the thread's
    length, and whether the last message came from the other side (the
    candidate, or the partner), so the ball is in staff's court."""
    pending = db.scalar(select(func.count()).select_from(Document).where(
        Document.candidate_id == candidate_id, Document.verification_status == VerificationStatus.pending)) or 0
    messages = db.scalar(select(func.count()).select_from(CandidateMessage).where(CandidateMessage.candidate_id == candidate_id)) or 0
    last_role = db.scalar(
        select(User.role).join(CandidateMessage, CandidateMessage.sender_id == User.id)
        .where(CandidateMessage.candidate_id == candidate_id).order_by(CandidateMessage.created_at.desc()).limit(1)
    )
    return {"pending_documents_count": pending, "message_count": messages, "awaiting_reply": last_role is external_role}


def _completeness(db: Session, candidate_id: str | None) -> dict[str, Any] | None:
    if not candidate_id:
        return None
    result = document_completeness(db, candidate_id)
    return {"complete": result.complete, "missingTypes": result.missing_types}


def _destinations(db: Session, applications: list[Application]) -> dict[str, str | None]:
    """Each application's destination country id: its preferred country, or
    the Country named like its job's country (ignoring case)."""
    names = {a.job.country.lower() for a in applications if not a.preferred_country_1_id and a.job}
    by_name = {n.lower(): i for i, n in db.execute(select(Country.id, Country.name).where(func.lower(Country.name).in_(names)))} if names else {}
    return {a.id: a.preferred_country_1_id or (by_name.get(a.job.country.lower()) if a.job else None) for a in applications}


def _with_requirements(db: Session, applications: list[Application], shape: Any) -> tuple[list[dict[str, Any]], list[str]]:
    """Each application with the document types it needs, and the union."""
    dest = _destinations(db, applications)
    required = required_types_by_country(db, dest.values())
    rows = [shape(a) | {"required_document_types": required.get(dest[a.id]) or required[None]} for a in applications]
    return rows, list(dict.fromkeys(t for types in required.values() for t in types))


# --- shapes (the website's selects) ----------------------------------------------------

NAME = lambda r: pick(r, "name")  # noqa: E731
PERSON = lambda u: pick(u, "full_name", "email")  # noqa: E731
STAFF_REF = lambda u: pick(u, "id", "full_name")  # noqa: E731
STAGES = ordered(full, "order")


def _list_candidate(c: Candidate) -> dict[str, Any]:
    latest = sorted(c.applications, key=lambda a: a.submitted_at, reverse=True)[:1]
    return pick(
        c, "id", "source", "lifecycle_status", "nationality", "date_of_birth", "passport_number", "full_name", "phone", "email",
        "desired_role", "consent_given", "return_reason", "screening_result", "created_at", "second_nationality", "gender",
        "passport_expiry", "current_occupation", "highest_education", "home_address", "whatsapp_number", "marital_status",
        "country_name", "referral_duplicate_flag",
        user=PERSON, recruiter=STAFF_REF,
        country=lambda k: pick(k, "id", "name", region=lambda r: pick(r, "id", "name")),
        partner=lambda p: pick(p, "id", "name"),
        referral_agent=lambda a: pick(a, "id", "full_name", "referral_code"),
        documents=lambda d: pick(d, "id", "type", "verification_status"),
    ) | {"applications": [pick(a, job=lambda j: pick(j, "title"), preferred_sector=NAME, preferred_country_1=NAME) for a in latest]}


def _detail_application(a: Application) -> dict[str, Any]:
    return pick(
        a, "id", "application_status", "submitted_at", "job_id", "job_position_id", "preferred_country_1_id", "preferred_sector_id",
        "earliest_travel_date", "prior_eu_visa_applied", "prior_eu_visa_applied_details", "documents_available",
        "current_location_country_name", "holds_schengen_visa", "holds_schengen_visa_details", "prior_visa_refusals",
        "prior_visa_refusals_details", "available_for_embassy_appointment", "willing_to_start_within_30_days",
        "preferred_contact_channel", "payment_plan_acknowledged",
        job=lambda j: pick(j, "title", "country", "city"),
        job_position=lambda p: pick(p, "title", "city", job_sector=lambda s: pick(s, "sector")),
        preferred_country_1=lambda k: pick(k, "id", "name"), preferred_country_2=lambda k: pick(k, "id", "name"),
        preferred_country_3=lambda k: pick(k, "id", "name"), preferred_sector=lambda k: pick(k, "id", "name"),
        current_location_country=lambda k: pick(k, "id", "name"),
        case=lambda k: pick(k, "id"),
    )


def _submission_job(j: Job) -> dict[str, Any]:
    return pick(j, "id", "title", "country", "city", "service_fee_gbp", "is_credit_service", payment_stages=STAGES)


def _position(p: Any) -> dict[str, Any]:
    return pick(p, "title", "city", job_sector=lambda s: pick(s, "sector"))


# --- candidates ---------------------------------------------------------------------


@router.get("/candidates")
def list_candidates(
    db: DbSession, user: CandidateReader,
    period_start: str | None = None, period_end: str | None = None, q: str | None = None, status: str | None = None,
    source: str | None = None, country_id: str | None = None, country: str | None = None, programme: str | None = None,
    programmeCountry: str | None = None, filterOptions: str | None = None,  # noqa: N803
    signals_: Annotated[str | None, Query(alias="signals")] = None,
    page: str | None = None, pageSize: str | None = None, sortBy: str | None = None, sortDir: str | None = None,  # noqa: N803
) -> dict[str, Any]:
    """The caller's candidates (candidate_scope). With period_start and
    period_end, every one created in that window (the recruiter's report);
    otherwise searched, filtered, sorted and paged, optionally with the
    opportunity filter options and HR's attention signals."""
    scope = candidate_scope(db, user)
    if period_start and period_end:
        rows = db.scalars(select(Candidate).where(scope, Candidate.created_at >= _date(period_start), Candidate.created_at <= _date(period_end))
                          .order_by(Candidate.created_at.desc(), Candidate.id))
        return {"data": [_list_candidate(c) for c in rows]}

    sources = [_enum(CandidateSource, s, "source") for s in (source or "").strip().split(",") if s] if (source or "").strip() else []
    opp = _opportunity({"country": country, "programme": programme, "programmeCountry": programmeCountry})
    wants_options = filterOptions == "true"
    options = job_filter = None
    if wants_options or opp.any:
        in_use = select(Application.job_id).join(Candidate, Candidate.id == Application.candidate_id)
        if sources:
            in_use = in_use.where(Candidate.source.in_(sources))
        options, job_filter = resolve(db, Job.id.in_(in_use), opp)

    where: list[ColumnElement[bool]] = [scope]
    if (status or "").strip():
        where.append(Candidate.lifecycle_status == _enum(CandidateLifecycleStatus, status.strip(), "status"))  # type: ignore[union-attr]
    if sources:
        where.append(Candidate.source.in_(sources))
    if (country_id or "").strip():
        where.append(Candidate.country_id == country_id.strip())  # type: ignore[union-attr]
    if job_filter is not None:
        where.append(Candidate.id.in_(select(Application.candidate_id).join(Job, Job.id == Application.job_id).where(job_filter)))
    if (q or "").strip():
        term = q.strip()  # type: ignore[union-attr]
        where.append(or_(
            _ilike(Candidate.full_name, term), _ilike(Candidate.email, term), _ilike(Candidate.phone, term),
            Candidate.user_id.in_(select(User.id).where(or_(_ilike(User.full_name, term), _ilike(User.email, term)))),
            Candidate.id.in_(select(Application.candidate_id).join(Job, Job.id == Application.job_id).where(_ilike(Job.title, term))),
        ))

    page_n, size = _paging(page, pageSize, 15, 100)
    key = {"full_name": Candidate.full_name, "lifecycle_status": Candidate.lifecycle_status}.get(sortBy or "", Candidate.created_at)
    asc = sortDir == "asc"
    total = db.scalar(select(func.count()).select_from(Candidate).where(*where)) or 0
    rows = list(db.scalars(select(Candidate).where(*where)
                           .order_by(key.asc() if asc else key.desc(), Candidate.id.asc() if asc else Candidate.id.desc())
                           .offset((page_n - 1) * size).limit(size)))
    body: dict[str, Any] = {"data": [_list_candidate(c) for c in rows], "total": total, "page": page_n, "pageSize": size}
    if signals_ == "true":
        def with_signals(c: Candidate) -> dict[str, Any]:
            s = signals(db, c.id, Role.candidate)
            return {"pending_documents_count": s["pending_documents_count"], "message_count": s["message_count"], "awaiting_hr_reply": s["awaiting_reply"]}

        body["data"] = [row | with_signals(c) for row, c in zip(body["data"], rows, strict=True)]
        matching = db.scalars(select(Candidate.id).where(*where))
        body["summary"] = {
            "ready_for_approval_count": db.scalar(select(func.count()).select_from(Candidate).where(*where, Candidate.lifecycle_status == CandidateLifecycleStatus.submitted)) or 0,
            "awaiting_reply_count": sum(1 for cid in matching if signals(db, cid, Role.candidate)["awaiting_reply"]),
        }
    if wants_options and options is not None:
        body["filter_options"] = options
    return body


@router.get("/candidates/profile")
def own_profile(db: DbSession, user: CurrentUser) -> dict[str, Any]:
    """The signed-in candidate's own record, documents and application count."""
    c = db.scalars(select(Candidate).where(Candidate.user_id == user.user_id)).first()
    if c is None:
        raise ApiError(404, "not_found", "Profile not found.")
    profile = full(c, user=lambda u: pick(u, "full_name", "email", "phone", "country"),
                   documents=lambda d: pick(d, "id", "type", "verification_status", "uploaded_at", "label"))
    return {"data": profile | {"_count": {"applications": len(c.applications)}}}


@router.get("/candidates/{candidate_id}")
def get_candidate(candidate_id: str, db: DbSession, user: CandidateReader) -> dict[str, Any]:
    """One candidate the caller may see, with each application's required
    documents, the union of them, and (for a candidate the screening gate
    failed) why it failed."""
    c = db.get(Candidate, candidate_id)
    if c is None:
        raise ApiError(404, "not_found", "Candidate not found.")
    if not can_access_candidate(db, user, CandidateRef.of(c)):
        raise ApiError(403, "forbidden", "Forbidden.")
    applications = sorted(c.applications, key=lambda a: a.submitted_at, reverse=True)
    rows, required = _with_requirements(db, applications, _detail_application)
    data = pick(
        c, "id", "source", "lifecycle_status", "nationality", "date_of_birth", "passport_number", "full_name", "phone", "email",
        "desired_role", "consent_given", "consent_at", "return_reason", "screening_result", "screening_evaluated_at", "created_at",
        "user_id", "recruiter_id", "country_id", "country_name", "second_nationality", "gender", "passport_expiry",
        "current_occupation", "highest_education", "home_address", "whatsapp_number", "marital_status", "referral_duplicate_flag",
        user=lambda u: pick(u, "full_name", "email", "phone"), recruiter=STAFF_REF,
        country=lambda k: pick(k, "id", "name"),
        referral_agent=lambda a: pick(a, "id", "full_name", "referral_code"),
        documents=lambda d: pick(d, "id", "type", "verification_status", "uploaded_at", "label"),
    ) | {"applications": rows, "required_document_types": required}
    if c.lifecycle_status is CandidateLifecycleStatus.identified and c.screening_result is False:
        data["screening_failures"] = evaluate_screening_gate(c).failures
    return {"data": data}


@router.get("/candidates/{candidate_id}/messages")
def list_messages(candidate_id: str, db: DbSession, user: CurrentUser) -> dict[str, Any]:
    """A candidate's thread, oldest first, for those on it (_thread_access)."""
    c = db.get(Candidate, candidate_id)
    if c is None:
        raise ApiError(404, "not_found", "Candidate not found.")
    if not _thread_access(db, user, c):
        raise ApiError(403, "forbidden", "Forbidden.")
    rows = db.scalars(select(CandidateMessage).where(CandidateMessage.candidate_id == candidate_id).order_by(CandidateMessage.created_at, CandidateMessage.id))
    return {"data": [pick(m, "id", "body", "created_at", "updated_at", "sender_id", sender=lambda u: pick(u, "full_name", "role")) for m in rows]}


# --- applications --------------------------------------------------------------------


@router.get("/applications")
def list_applications(db: DbSession, user: CurrentUser, page: str | None = None, pageSize: str | None = None) -> dict[str, Any]:  # noqa: N803
    """Staff: the applications of the candidates they may see, newest
    first, paged. Anyone else: their own applications, each with the
    documents it needs; data is null when they have no candidate record."""
    if user.role in STAFF_ROLES:
        where = Application.candidate_id.in_(select(Candidate.id).where(candidate_scope(db, user)))
        page_n, size = _paging(page, pageSize, 50, 200)
        total = db.scalar(select(func.count()).select_from(Application).where(where)) or 0
        rows = db.scalars(select(Application).where(where).order_by(Application.submitted_at.desc(), Application.id.desc()).offset((page_n - 1) * size).limit(size))
        shape = lambda a: full(  # noqa: E731
            a,
            candidate=lambda c: pick(c, "full_name", documents=lambda d: pick(d, "id", "type", "verification_status"), user=PERSON,
                                     recruiter=STAFF_REF, country=lambda k: pick(k, "id", "name")),
            job=lambda j: pick(j, "title", "country", "city"), preferred_country_1=NAME, preferred_sector=NAME,
        )
        return {"data": [shape(a) for a in rows], "total": total, "page": page_n, "pageSize": size}

    c = db.scalars(select(Candidate).where(Candidate.user_id == user.user_id)).first()
    if c is None:
        return {"data": None}
    applications = list(db.scalars(select(Application).where(Application.candidate_id == c.id).order_by(Application.submitted_at.desc(), Application.id.desc())))
    shape = lambda a: full(a, job=lambda j: pick(j, "id", "title", "country", "city", "salary_range"), preferred_country_1=NAME, preferred_sector=NAME)  # noqa: E731
    rows, _ = _with_requirements(db, applications, shape)
    return {"data": rows}


@router.get("/applications/{application_id}")
def get_application(application_id: str, db: DbSession, user: CurrentUser) -> dict[str, Any]:
    """An application with its candidate and job: for the candidate it
    belongs to, a director or admin, or an in-house supervisor whose
    countries include the candidate's (Q3)."""
    a = db.get(Application, application_id)
    if a is None:
        raise ApiError(404, "not_found", "Application not found.")
    c = a.candidate
    allowed = (
        c.user_id == user.user_id
        or user.role in (Role.director, Role.admin)
        or (user.role is Role.inhouse_supervisor and c.country_id is not None and c.country_id in inhouse_country_ids(db, user.user_id))
    )
    if not allowed:
        raise ApiError(403, "forbidden", "Forbidden.")
    return {"data": full(a, candidate=lambda k: full(k, user=PERSON), job=full)}


# --- a partner's own submissions ----------------------------------------------------------


def _own_partner(db: Session, user: AuthUser) -> Partner:
    partner = db.scalars(select(Partner).where(Partner.user_id == user.user_id)).first()
    if partner is None:
        raise ApiError(404, "not_found", "Partner record not found.")
    return partner


@router.get("/partner/candidates")
def partner_submissions(db: DbSession, user: PartnerUser) -> dict[str, Any]:
    """The partner's submissions, newest first, each flagged when a document
    was rejected or the last message came from Vertex's side."""
    partner = _own_partner(db, user)
    out = []
    for pc in db.scalars(select(PartnerCandidate).where(PartnerCandidate.partner_id == partner.id).order_by(PartnerCandidate.submitted_at.desc().nulls_first(), PartnerCandidate.id.desc())):
        row = full(pc, job=lambda j: pick(j, "title", "country", "city"))
        cid = pc.bridged_candidate_id
        rejected = bool(cid) and (db.scalar(select(func.count()).select_from(Document).where(
            Document.candidate_id == cid, Document.verification_status == VerificationStatus.rejected)) or 0) > 0
        last_role = db.scalar(select(User.role).join(CandidateMessage, CandidateMessage.sender_id == User.id)
                              .where(CandidateMessage.candidate_id == cid).order_by(CandidateMessage.created_at.desc()).limit(1)) if cid else None
        out.append(row | {"has_rejected_document": rejected, "awaiting_partner_reply": last_role is not None and last_role is not Role.partner})
    return {"data": out, "summary": {"needs_attention_count": sum(1 for r in out if r["has_rejected_document"] or r["awaiting_partner_reply"])}}


@router.get("/partner/candidates/{submission_id}")
def partner_submission(submission_id: str, db: DbSession, user: PartnerUser) -> dict[str, Any]:
    """One of the partner's own submissions."""
    partner = _own_partner(db, user)
    pc = db.get(PartnerCandidate, submission_id)
    if pc is None or pc.partner_id != partner.id:
        raise ApiError(404, "not_found", "Submission not found.")
    return {"data": full(
        pc, job=_submission_job, job_position=_position, current_location_country=NAME,
        documents=lambda d: pick(d, "id", "type", "label", "uploaded_at"),
        bridged_candidate=lambda k: pick(k, "id", documents=lambda d: pick(d, "id", "type", "verification_status", "uploaded_at", "label")),
    )}


# --- HR's partner-submission queue (Q2: global) ----------------------------------------------


@router.get("/partner-candidates")
def submission_queue(
    db: DbSession, _user: SubmissionReader,
    q: str | None = None, status: str | None = None, page: str | None = None, pageSize: str | None = None,  # noqa: N803
    sortBy: str | None = None, sortDir: str | None = None, country: str | None = None, programme: str | None = None,  # noqa: N803
    programmeCountry: str | None = None,  # noqa: N803
) -> dict[str, Any]:
    """Every submitted (never draft) partner submission, searched, filtered,
    sorted and paged, each with its document completeness and attention
    signals, the queue's totals and the opportunity filter options."""
    not_draft = PartnerCandidate.status != PartnerCandidateStatus.draft
    options, job_filter = resolve(db, Job.id.in_(select(PartnerCandidate.job_id).where(not_draft)),
                                  _opportunity({"country": country, "programme": programme, "programmeCountry": programmeCountry}))
    where: list[ColumnElement[bool]] = [not_draft]
    if (status or "").strip():
        where.append(PartnerCandidate.status == _enum(PartnerCandidateStatus, status.strip(), "status"))  # type: ignore[union-attr]
    if (q or "").strip():
        term = q.strip()  # type: ignore[union-attr]
        where.append(or_(
            _ilike(PartnerCandidate.full_name, term), _ilike(PartnerCandidate.email, term),
            PartnerCandidate.partner_id.in_(select(Partner.id).where(_ilike(Partner.name, term))),
            PartnerCandidate.job_id.in_(select(Job.id).where(_ilike(Job.title, term))),
        ))
    if job_filter is not None:
        where.append(PartnerCandidate.job_id.in_(select(Job.id).where(job_filter)))

    page_n, size = _paging(page, pageSize, 15, 100)
    asc = sortDir == "asc"
    query = select(PartnerCandidate).where(*where)
    if sortBy == "partner":
        query, key = query.join(Partner, Partner.id == PartnerCandidate.partner_id), Partner.name
    else:
        key = {"full_name": PartnerCandidate.full_name, "status": PartnerCandidate.status, "submitted_at": PartnerCandidate.submitted_at}.get(sortBy or "", PartnerCandidate.updated_at)
    order = (key.asc() if asc else key.desc(), PartnerCandidate.id.asc() if asc else PartnerCandidate.id.desc())
    total = db.scalar(select(func.count()).select_from(PartnerCandidate).where(*where)) or 0
    rows = db.scalars(query.order_by(*order).offset((page_n - 1) * size).limit(size))

    def queue_signals(cid: str | None) -> dict[str, Any]:
        if not cid:
            return {"pending_documents_count": 0, "message_count": 0, "awaiting_hr_reply": False}
        s = signals(db, cid, Role.partner)
        return {"pending_documents_count": s["pending_documents_count"], "message_count": s["message_count"], "awaiting_hr_reply": s["awaiting_reply"]}

    data = [
        full(pc, partner=lambda p: pick(p, "id", "name", "contact_email"), job=lambda j: pick(j, "title", "country", "city"))
        | {"document_completeness": _completeness(db, pc.bridged_candidate_id)} | queue_signals(pc.bridged_candidate_id)
        for pc in rows
    ]
    matching = [queue_signals(cid) for cid in db.scalars(select(PartnerCandidate.bridged_candidate_id).where(*where)) if cid]
    summary = {"pending_review_count": sum(1 for s in matching if s["pending_documents_count"] > 0),
               "awaiting_reply_count": sum(1 for s in matching if s["awaiting_hr_reply"])}
    return {"data": data, "total": total, "page": page_n, "pageSize": size, "summary": summary, "filter_options": options}


@router.get("/partner-candidates/{submission_id}")
def submission(submission_id: str, db: DbSession, _user: SubmissionReader) -> dict[str, Any]:
    """One submitted partner submission, with its document completeness and
    every document type its destination needs."""
    pc = db.get(PartnerCandidate, submission_id)
    if pc is None or pc.status is PartnerCandidateStatus.draft:
        raise ApiError(404, "not_found", "Partner candidate submission not found.")
    country_id = db.scalar(select(Country.id).where(func.lower(Country.name) == pc.job.country.lower())) if pc.job else None
    required = required_types_by_country(db, [country_id])
    return {"data": full(
        pc, partner=lambda p: pick(p, "id", "name", "contact_email", "contact_name", "contact_phone"),
        job=_submission_job, job_position=_position, current_location_country=NAME, reviewer=lambda u: pick(u, "full_name"),
        bridged_candidate=lambda k: pick(k, "id", documents=lambda d: pick(d, "id", "type", "label", "verification_status", "uploaded_at")),
    ) | {"document_completeness": _completeness(db, pc.bridged_candidate_id), "required_document_types": required.get(country_id) or required[None]}}
