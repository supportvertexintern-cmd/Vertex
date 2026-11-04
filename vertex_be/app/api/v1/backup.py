"""The backup export, its catalogue and record picker, and the candidates
CSV (reads handover R7c, D5 A), moved from the website's /api/backup/* and
/api/admin/backup/candidates-csv. The same roles, files and audit records:
each export is on the trail before its data leaves (fail closed: if it
can't be recorded, it isn't made). The engine is app/services/backup.py.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends
from fastapi.responses import Response
from pydantic import ValidationError
from sqlalchemy import or_, select

from app.api.deps import DbSession
from app.core.api import ApiError, js_date
from app.core.audit import append_event
from app.core.auth import AuthUser
from app.core.logging import REDACTED
from app.core.rbac import require_role
from app.models.candidate import Candidate
from app.models.enums import Role, VerificationStatus
from app.models.identity import User
from app.services import backup

router = APIRouter()

BackupUser = Annotated[AuthUser, Depends(require_role(*backup.BACKUP_ROLES))]
CANDIDATE_CSV_ROLES = (Role.admin, Role.operations_team, Role.operations_director, Role.director, Role.hr)
CandidateCsvUser = Annotated[AuthUser, Depends(require_role(*CANDIDATE_CSV_ROLES))]

# Filter values safe to keep on the (immutable) trail; anything else, such
# as free text that could hold a name, is kept by name only (auditFilters).
AUDITABLE_FILTER_KEYS = {"start", "end", "from", "to", "status", "stage", "source", "country", "country_id", "region_id", "partner_id",
                         "recruiter_id", "page", "limit"}


def _audit(user: AuthUser, entity_type: str, detail: dict[str, Any]) -> None:
    try:
        append_event("export", actor_id=user.user_id, entity_type=entity_type, entity_id="bulk", detail=detail)
    except Exception:  # noqa: BLE001
        raise ApiError(503, "audit_unavailable", "The export couldn't be recorded, so it wasn't made.") from None


@router.get("/backup/catalog")
def catalog(user: BackupUser) -> dict[str, Any]:
    """Every table, column and relationship this role may export."""
    return {"data": backup.describe(user.role)}


# --- the record picker ----------------------------------------------------------------------


def _path_matches(cls: Any, path: list[str], q: str) -> Any:
    attr = getattr(cls, path[0])
    if len(path) == 1:
        return attr.icontains(q, autoescape=True)
    return attr.has(_path_matches(attr.property.mapper.class_, path[1:], q))


def _read(row: Any, path: list[str]) -> Any:
    for key in path:
        row = getattr(row, key, None) if row is not None else None
    return row


@router.get("/backup/records")
def records(db: DbSession, user: BackupUser, model: str = "", q: str = "") -> dict[str, Any]:
    """Up to 25 records for the export builder's "specific records" filter:
    by the table's label (a name, title or reference, or the linked
    candidate's name) or an exact id, within the role's row filter."""
    m = backup.mapper(model)
    if m is None or not backup.can_export(user.role, model):
        raise ApiError(403, "forbidden", "Table not available for export.")
    cls, table = m.class_, m.local_table
    pk = backup.primary_key(m)
    paths = backup.label_paths(m) or []
    date_field = backup.default_date_field(m)
    term = q.strip()

    query = select(cls)
    if term:
        query = query.where(or_(getattr(cls, pk) == term, *(_path_matches(cls, p, term) for p in paths)))
    scoped = backup.row_filter(user.role, model, table)  # type: ignore[arg-type]
    if scoped is not None:
        query = query.where(scoped)
    order = getattr(cls, date_field).desc() if date_field else getattr(cls, pk).asc()
    rows = list(db.scalars(query.order_by(order, getattr(cls, pk)).limit(25)))

    # Labels can be personal data: who looked up which table and how many
    # rows came back, never the search text.
    _audit(user, model, {"purpose": "backup_record_picker", "rows": len(rows), "searched": term != ""})

    def label(row: Any) -> str:
        found = next((v for v in (_read(row, p) for p in paths) if isinstance(v, str) and v.strip()), None)
        return found if found is not None else str(getattr(row, pk))

    def when(row: Any) -> str | None:
        value = getattr(row, date_field) if date_field else None
        return backup._iso(value) if value else None  # noqa: SLF001

    return {"data": {"records": [{"id": str(getattr(r, pk)), "label": label(r), "date": when(r)} for r in rows]}}


# --- the export -------------------------------------------------------------------------------------


@router.post("/backup/export", response_class=Response)
def export(db: DbSession, user: BackupUser, body: Annotated[dict[str, Any], Body()]) -> Response:
    """A full backup or a custom export, as a ZIP."""
    try:
        request = backup.FullRequest.model_validate(body) if body.get("mode") == "full" else backup.CustomRequest.model_validate(body)
    except ValidationError as err:
        raise ApiError(400, "invalid_export", "Invalid export request.", {"issues": err.errors(include_url=False, include_context=False)}) from None
    actor_row = db.get(User, user.user_id)
    actor = backup.Actor(user.user_id, user.role, actor_row.full_name if actor_row else None, actor_row.email if actor_row else user.email)
    try:
        result = backup.build_export(db, actor, request)
    except backup.ExportValidationError as err:
        raise ApiError(400, "invalid_export", str(err)) from None
    manifest = result.manifest
    _audit(user, "DataExport", {"filename": result.filename, "export_type": manifest["export_type"], "role": user.role.value,
                                "request": manifest["request"], "sections": manifest["sections"]})
    return Response(result.zip, media_type="application/zip", headers={
        "Content-Disposition": f'inline; filename="{result.filename}"', "Cache-Control": "no-store",
    })


# --- the candidates CSV ---------------------------------------------------------------------------------


def _csv_cell(value: Any) -> str:
    text = "" if value is None else str(value)
    return '"' + text.replace('"', '""') + '"' if any(ch in text for ch in '",\n') else text


def _yes_no(value: bool | None) -> str:
    return "" if value is None else ("Yes" if value else "No")


def _day(value: datetime | None) -> str:
    return value.date().isoformat() if value else ""


CANDIDATE_CSV_HEADER = [
    "ID", "Name", "Email", "Phone", "Source", "Status", "Nationality", "Second Nationality", "Date of Birth", "Passport Number",
    "Passport Expiry", "Current Occupation", "Highest Education", "Home Address", "WhatsApp Number", "Marital Status", "Desired Role",
    "Region", "Country", "Recruiter", "Partner", "Consent Given", "Consent Date", "Screening Result", "Screening Evaluated",
    "Return Reason", "Programme", "Destination", "Earliest Travel Date", "Prior EU Visa Applied", "Prior EU Visa Applied Details",
    "Current Location", "Holds Schengen Visa", "Holds Schengen Visa Details", "Prior Visa Refusals", "Prior Visa Refusals Details",
    "Available for Embassy Appointment", "Willing to Start Within 30 Days", "Preferred Contact Channel",
    "Documents Self-Reported Available", "Payment Plan Acknowledged", "Application Submitted", "Case Stage",
    "Case Documentation Review Status", "Case Created", "Documents Uploaded", "Documents Verified", "Documents Rejected",
    "Candidate Record Created",
]


def _candidate_row(c: Candidate) -> list[Any]:
    app = max(c.applications, key=lambda a: a.submitted_at, default=None)
    docs = c.documents
    first = lambda *vals: next((v for v in vals if v is not None), "")  # noqa: E731  (a ?? b ?? "")
    if app is not None and app.job is not None:
        programme, destination = app.job.title, f"{app.job.city}, {app.job.country}"
    else:
        programme = app.preferred_sector.name if app is not None and app.preferred_sector else ""
        destination = " / ".join(k.name for k in ((app.preferred_country_1, app.preferred_country_2, app.preferred_country_3) if app else ()) if k and k.name)
    kase = app.case if app is not None else None
    screening = "Not yet evaluated" if c.screening_result is None else ("Passed" if c.screening_result else "Failed")
    value = lambda v: getattr(v, "value", v)  # noqa: E731
    return [
        c.id, first(c.user.full_name if c.user else None, c.full_name), first(c.user.email if c.user else None, c.email),
        first(c.user.phone if c.user else None, c.phone), value(c.source), value(c.lifecycle_status), first(c.nationality),
        first(c.second_nationality), _day(c.date_of_birth), first(c.passport_number), _day(c.passport_expiry), first(c.current_occupation),
        first(c.highest_education), first(c.home_address), first(c.whatsapp_number), first(c.marital_status), first(c.desired_role),
        c.country.region.name if c.country else "", c.country.name if c.country else "", c.recruiter.full_name if c.recruiter else "",
        c.partner.name if c.partner else "", _yes_no(c.consent_given), _day(c.consent_at), screening, _day(c.screening_evaluated_at),
        first(c.return_reason), programme, destination, _day(app.earliest_travel_date if app else None),
        _yes_no(app.prior_eu_visa_applied if app else None), first(app.prior_eu_visa_applied_details if app else None),
        first(app.current_location_country.name if app and app.current_location_country else None, app.current_location_country_name if app else None),
        _yes_no(app.holds_schengen_visa if app else None), first(app.holds_schengen_visa_details if app else None),
        _yes_no(app.prior_visa_refusals if app else None), first(app.prior_visa_refusals_details if app else None),
        _yes_no(app.available_for_embassy_appointment if app else None), _yes_no(app.willing_to_start_within_30_days if app else None),
        first(value(app.preferred_contact_channel) if app else None), "; ".join(app.documents_available or []) if app else "",
        _yes_no(app.payment_plan_acknowledged if app else None), _day(app.submitted_at if app else None),
        value(kase.current_stage) if kase else "", value(kase.ops_review_status) if kase else "", _day(kase.created_at if kase else None),
        len(docs), sum(1 for d in docs if d.verification_status is VerificationStatus.verified),
        sum(1 for d in docs if d.verification_status is VerificationStatus.rejected), _day(c.created_at),
    ]


def _parse_day(raw: str) -> datetime:
    try:
        return js_date(raw)
    except ValueError:
        raise ApiError(422, "validation_error", "Invalid date.") from None


@router.get("/backup/candidates-csv", response_class=Response)
def candidates_csv(db: DbSession, user: CandidateCsvUser, start: str | None = None, end: str | None = None) -> Response:
    """Every candidate, with their latest application, case and document
    counts; start and end bound Candidate.created_at, inclusive."""
    query = select(Candidate)
    if start:
        query = query.where(Candidate.created_at >= _parse_day(start))
    if end:
        query = query.where(Candidate.created_at <= _parse_day(end) + timedelta(days=1) - timedelta(milliseconds=1))
    candidates = list(db.scalars(query.order_by(Candidate.created_at.desc(), Candidate.id)))
    lines = [",".join(_csv_cell(v) for v in row) for row in [CANDIDATE_CSV_HEADER, *(_candidate_row(c) for c in candidates)]]
    params = {"start": start, "end": end}
    _audit(user, "CandidateExport", {"rows": len(candidates), "filters": {
        k: (v[:100] if k in AUDITABLE_FILTER_KEYS else REDACTED) for k, v in params.items() if v is not None}})
    suffix = f"_{start or 'start'}_to_{end or 'end'}" if start or end else ""
    return Response("\n".join(lines), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="candidates{suffix}.csv"'})
