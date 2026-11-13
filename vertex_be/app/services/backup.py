"""The backup export (reads handover R7c, D5 A): the website's
server/backup/catalog.ts and exporter.ts, moved here. The same roles, table
catalogue, excluded tables and columns, row filters, and the same ZIP: one
CSV per table, relationships.csv, manifest.json and README.txt.

The catalogue is read from the models' own metadata (SQLAlchemy's mappers)
instead of Prisma's, so a new table or column shows up by itself. The hand-
kept parts are below, as before: which category a table is under, which
roles may export it, what is never exported, and the rows a role may not
see. Relationship names are the backend models' (User.direct_reports, where
Prisma said reports); the export builder reads them from the catalogue.

Two modes:
  full   — every table the role may export, every column, every row.
  custom — chosen sections: one root table each, with chosen columns,
           filters (a date range, enum values, specific records) and related
           tables followed through the models' relationships, recursively.
"""

from __future__ import annotations

import enum
import io
import json
import math
import re
import zipfile
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import ARRAY, Boolean, ColumnElement, Date, DateTime, Enum, Float, Integer, Numeric, String, Table, Text, and_, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapper, RelationshipProperty, Session
from sqlalchemy.types import JSON

from app.core.clock import utc_now_ms
from app.db.base import SOFT_DELETE_COLUMNS, Base
from app.models.enums import PartnerCandidateStatus, Role

BACKUP_ROLES = (Role.admin, Role.director, Role.operations_team, Role.operations_director, Role.hr, Role.finance)

CATEGORIES: list[tuple[str, str, list[str]]] = [
    ("candidates", "Candidates & Applications", ["Candidate", "Application", "CandidateMessage"]),
    ("partners", "Partners & Partner Submissions", ["Partner", "PartnerCandidate", "PartnerReport", "PartnerFollowUp"]),
    ("partner_commissions", "Partner Commissions & Admin Fees", ["PartnerCommission", "PartnerCommissionRule", "AdminFee"]),
    ("cases", "Cases", ["Case", "CaseStageEvent", "Contract", "CaseReminder", "RetentionFollowUp"]),
    ("payments", "Payments & Finance", ["CasePayment", "Payment", "ConsultationBooking", "FeePolicy"]),
    ("documents", "Documents", ["Document", "DocumentRequirementType", "CountryDocumentRequirement"]),
    ("jobs", "Jobs & Programmes", ["Job", "JobSector", "JobPosition", "JobPaymentStage", "JobMilestonePrice", "EmployerClient"]),
    ("users", "Users & Staff", ["User", "InhouseCountryAssignment", "StaffKpiTarget", "StaffScorecard", "StaffScorecardArea", "RecruiterTarget", "RecruiterNote"]),
    ("reporting", "Reporting & Governance", ["Report", "Exception", "ExceptionCorrectiveAction"]),
    ("campaigns", "Campaigns", ["Campaign", "CampaignTarget"]),
    ("referrals", "Referral Agents", ["ReferralAgent", "ReferralCommission", "ReferralCommissionRule", "ReferralAgentTarget"]),
    ("reference", "Reference Data", ["Region", "Country", "Sector"]),
    ("system", "System", ["SystemSetting", "KnowledgeArticle", "EmailTemplate"]),
]

MODEL_LABELS = {
    "PartnerCandidate": "Partner Submissions", "User": "Users", "CasePayment": "Case Payments", "Payment": "Application Fee Payments",
    "CandidateMessage": "Candidate Messages", "Case": "Cases", "Candidate": "Candidates", "Application": "Applications",
    "Document": "Documents", "Partner": "Partners", "Job": "Jobs / Opportunities",
}

# Tables no role may export, even through a relationship.
NEVER_EXPORTED = {
    "RefreshToken": "session credentials (refresh-token hashes, G19); not business data",
    "AuditLog": "the audit trail: read by no service, kept whole in the database backups",
    "SecurityAlert": "security alerts (addresses, what was attempted): reviewed in the app, kept whole in the database backups",
    "LoginLockout": "sign-in lockouts (addresses, email fingerprints): reviewed in the app, kept whole in the database backups",
    "AddressRule": "address blocks and allows (network addresses, reasons): managed in the app, kept whole in the database backups",
    "alembic_version": "migration bookkeeping",
}

ALL_MODELS = [m for _, _, models in CATEGORIES for m in models]
CORE_OPERATIONAL = [
    "Candidate", "Application", "CandidateMessage", "Partner", "PartnerCandidate", "Case", "CaseStageEvent", "Contract", "CaseReminder",
    "RetentionFollowUp", "CasePayment", "Document", "DocumentRequirementType", "CountryDocumentRequirement", "Job", "JobSector",
    "JobPosition", "JobPaymentStage", "User", "Region", "Country", "Sector",
]
# Each role's existing API access: referral data for the referral managers,
# consultations for operations and finance, the rest director and admin.
ROLE_MODELS: dict[Role, list[str]] = {
    Role.admin: ALL_MODELS,
    Role.director: ALL_MODELS,
    Role.operations_team: [*CORE_OPERATIONAL, "ConsultationBooking", "InhouseCountryAssignment"],
    Role.operations_director: [*CORE_OPERATIONAL, "ConsultationBooking", "InhouseCountryAssignment"],
    Role.hr: CORE_OPERATIONAL,
    Role.finance: [*CORE_OPERATIONAL, "Payment", "ConsultationBooking", "FeePolicy"],
}
# Credential material, never exported.
EXCLUDED_FIELDS = {"User": {"password_hash", "google_id"}}

# Label paths for the record picker: the first non-empty value wins.
LABEL_FIELD_CANDIDATES = ["full_name", "name", "title", "reference", "label", "email", "key", "event", "contact_name"]


def _candidate_name(*prefix: str) -> list[list[str]]:
    return [[*prefix, "user", "full_name"], [*prefix, "full_name"]]


LABEL_PATHS = {
    "Candidate": [*_candidate_name(), ["email"]],
    "Case": _candidate_name("application", "candidate"),
    "Application": _candidate_name("candidate"),
    "Document": _candidate_name("candidate"),
    "CandidateMessage": _candidate_name("candidate"),
    "CasePayment": _candidate_name("case", "application", "candidate"),
    "Contract": _candidate_name("case", "application", "candidate"),
    "CaseStageEvent": _candidate_name("case", "application", "candidate"),
}
DATE_FIELD_PRIORITY = ["created_at", "submitted_at", "recorded_at", "uploaded_at", "sent_at", "entered_at", "period_start", "updated_at"]

MAX_DEPTH = 4
BATCH = 500
IN_CHUNK = 1000
MAX_SECTIONS = 30
UTF8_BOM = "﻿"


class ExportValidationError(ValueError):
    pass


# --- the catalogue -------------------------------------------------------------------------


def _mappers() -> dict[str, Mapper[Any]]:
    return {m.local_table.name: m for m in Base.registry.mappers if isinstance(m.local_table, Table)}


def mapper(model: str) -> Mapper[Any] | None:
    return _mappers().get(model)


def row_filter(role: Role, model: str, table: Table) -> ColumnElement[bool] | None:
    """Rows a role may not see inside a table it may export: partner drafts
    never reach HR, operations or finance."""
    if model == "PartnerCandidate" and role in (Role.hr, Role.operations_team, Role.operations_director, Role.finance):
        return table.c.status != PartnerCandidateStatus.draft
    return None


def humanize(name: str) -> str:
    text = re.sub(r"([a-z])([A-Z])", r"\1 \2", name.replace("_", " "))
    return re.sub(r"\b\w", lambda m: m.group(0).upper(), text)


def model_label(model: str) -> str:
    return MODEL_LABELS.get(model, humanize(model))


def allowed_models(role: Role) -> list[str]:
    known = _mappers()
    return [m for m in ROLE_MODELS.get(role, []) if m in known]


def can_export(role: Role, model: str) -> bool:
    return model in allowed_models(role)


def primary_key(m: Mapper[Any]) -> str:
    return m.local_table.primary_key.columns.values()[0].name


@dataclass(frozen=True)
class FieldInfo:
    name: str
    type: str  # String | Int | Float | Boolean | DateTime | Json | enum
    is_list: bool
    enum_values: list[str] | None
    references: str | None


def _type_of(sa_type: Any) -> tuple[str, list[str] | None]:
    if isinstance(sa_type, Enum):
        return "enum", list(sa_type.enums)
    if isinstance(sa_type, (DateTime, Date)):
        return "DateTime", None
    if isinstance(sa_type, Boolean):
        return "Boolean", None
    if isinstance(sa_type, Integer):
        return "Int", None
    if isinstance(sa_type, (Float, Numeric)):
        return "Float", None
    if isinstance(sa_type, (JSON, JSONB)):
        return "Json", None
    if isinstance(sa_type, (String, Text)):
        return "String", None
    return "String", None


def fields(m: Mapper[Any]) -> list[FieldInfo]:
    """The columns that may be exported, in the model's order."""
    excluded = EXCLUDED_FIELDS.get(m.local_table.name, set())
    out = []
    for col in m.local_table.columns:
        if col.name in excluded or col.name in SOFT_DELETE_COLUMNS:
            continue
        is_list = isinstance(col.type, ARRAY)
        kind, values = _type_of(col.type.item_type if is_list else col.type)
        refs = next((fk.column.table.name for fk in col.foreign_keys), None)
        out.append(FieldInfo(col.name, kind, is_list, values, refs))
    return out


@dataclass(frozen=True)
class Link:
    parent_column: str
    related_column: str


def relations(m: Mapper[Any]) -> list[RelationshipProperty[Any]]:
    return [r for r in m.relationships if r.secondary is None and len(r.local_remote_pairs or []) == 1]


def link(rel: RelationshipProperty[Any]) -> Link:
    local, remote = rel.local_remote_pairs[0]  # type: ignore[index]
    return Link(local.name, remote.name)


def default_date_field(m: Mapper[Any]) -> str | None:
    dates = [f.name for f in fields(m) if f.type == "DateTime" and not f.is_list]
    return next((d for d in DATE_FIELD_PRIORITY if d in dates), dates[0] if dates else None)


def label_paths(m: Mapper[Any]) -> list[list[str]] | None:
    name = m.local_table.name
    if name in LABEL_PATHS:
        return LABEL_PATHS[name]
    strings = [f.name for f in fields(m) if f.type == "String" and not f.is_list]
    chosen = next((c for c in LABEL_FIELD_CANDIDATES if c in strings), None)
    return [[chosen]] if chosen else None


def category_of(model: str) -> str:
    return next((key for key, _, models in CATEGORIES if model in models), "system")


def describe(role: Role) -> dict[str, Any]:
    """describeCatalog(): everything this role can export."""
    allowed = allowed_models(role)
    tables = []
    for name in allowed:
        m = mapper(name)
        assert m is not None
        tables.append({
            "name": name, "label": model_label(name), "category": category_of(name), "primaryKey": primary_key(m),
            "defaultDateField": default_date_field(m), "searchable": label_paths(m) is not None,
            "fields": [{"name": f.name, "label": humanize(f.name), "type": f.type, "isList": f.is_list, "enumValues": f.enum_values,
                        "references": f.references} for f in fields(m)],
            "relations": [{"name": r.key, "label": humanize(r.key), "model": r.mapper.local_table.name, "isList": bool(r.uselist)}
                          for r in relations(m) if r.mapper.local_table.name in allowed],
        })
    categories = [{"key": key, "label": label, "models": [x for x in models if x in allowed]} for key, label, models in CATEGORIES]
    return {"categories": [c for c in categories if c["models"]], "tables": tables}


# --- the request ---------------------------------------------------------------------------


class ExportNode(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model: str
    fields: list[str] | None = None
    relations: dict[str, ExportNode] | None = None


ExportNode.model_rebuild()


class SectionFilters(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dateField: str | None = None  # noqa: N815  (the builder's JSON)
    start: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    end: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    enums: dict[str, list[str]] | None = None
    ids: list[str] | None = Field(default=None, max_length=5000)


class Section(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
    root: ExportNode
    filters: SectionFilters | None = None


class FullRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Literal["full"]


class CustomRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Literal["custom"]
    sections: list[Section] = Field(min_length=1, max_length=MAX_SECTIONS)


# --- collecting rows -------------------------------------------------------------------------


Row = dict[str, Any]


@dataclass
class TableRows:
    rows: dict[str, Row] = field(default_factory=dict)
    columns: set[str] = field(default_factory=set)


TableSet = dict[str, TableRows]


def _require(role: Role, name: str) -> Mapper[Any]:
    m = mapper(name)
    if m is None or not can_export(role, name):
        raise ExportValidationError(f'You don\'t have access to export "{name}".')
    return m


def _columns(m: Mapper[Any], requested: list[str] | None) -> list[str]:
    available = [f.name for f in fields(m)]
    if not requested:
        return available
    unknown = [c for c in requested if c not in available]
    if unknown:
        raise ExportValidationError(f"Unknown column(s) on {m.local_table.name}: {', '.join(unknown)}")
    return [c for c in available if c in requested]  # the model's order


def _fetch(db: Session, role: Role, m: Mapper[Any], where: list[ColumnElement[bool]]) -> list[Row]:
    """Every exportable column (relationships need the keys even when they
    aren't chosen), in primary-key batches."""
    table: Table = m.local_table  # type: ignore[assignment]
    pk = table.c[primary_key(m)]
    cols = [table.c[f.name] for f in fields(m)]
    if pk.name not in {c.name for c in cols}:
        cols.append(pk)
    conditions = list(where)
    # These are the table's own columns, which the ORM's soft delete filter
    # (app/db/soft_delete.py) doesn't see: deleted rows aren't exported.
    if "deleted_at" in table.c:
        conditions.append(table.c.deleted_at.is_(None))
    scoped = row_filter(role, table.name, table)
    if scoped is not None:
        conditions.append(scoped)
    rows: list[Row] = []
    last: Any = None
    while True:
        query = select(*cols).where(*conditions)
        if last is not None:
            query = query.where(pk > last)
        batch = [dict(r._mapping) for r in db.execute(query.order_by(pk).limit(BATCH))]
        rows.extend(batch)
        if len(batch) < BATCH:
            return rows
        last = batch[-1][pk.name]


def _fetch_in(db: Session, role: Role, m: Mapper[Any], column: str, values: list[Any]) -> list[Row]:
    table: Table = m.local_table  # type: ignore[assignment]
    out: list[Row] = []
    for i in range(0, len(values), IN_CHUNK):
        out.extend(_fetch(db, role, m, [table.c[column].in_(values[i : i + IN_CHUNK])]))
    return out


def _add(tables: TableSet, m: Mapper[Any], rows: Iterable[Row], columns: list[str]) -> None:
    entry = tables.setdefault(m.local_table.name, TableRows())
    entry.columns.update(columns)
    pk = primary_key(m)
    for row in rows:
        entry.rows[str(row[pk])] = row


def _collect(db: Session, role: Role, node: ExportNode, rows: list[Row], tables: TableSet, depth: int) -> None:
    m = _require(role, node.model)
    _add(tables, m, rows, _columns(m, node.fields))
    if not node.relations:
        return
    if depth >= MAX_DEPTH:
        raise ExportValidationError(f"Related tables can only be nested {MAX_DEPTH} levels deep.")
    for name, child in node.relations.items():
        rel = next((r for r in relations(m) if r.key == name), None)
        if rel is None or rel.mapper.local_table.name != child.model:
            raise ExportValidationError(f'"{name}" is not a relationship of {m.local_table.name}.')
        target = _require(role, child.model)
        joined = link(rel)
        values = list(dict.fromkeys(r[joined.parent_column] for r in rows if r.get(joined.parent_column) is not None))
        related = _fetch_in(db, role, target, joined.related_column, values) if values else []
        _collect(db, role, child, related, tables, depth + 1)


def _section_where(m: Mapper[Any], filters: SectionFilters | None) -> list[ColumnElement[bool]]:
    if filters is None:
        return []
    table: Table = m.local_table  # type: ignore[assignment]
    info = {f.name: f for f in fields(m)}
    where: list[ColumnElement[bool]] = []
    if filters.start or filters.end:
        f = info.get(filters.dateField or "")
        if f is None or f.type != "DateTime":
            raise ExportValidationError(f"Pick a date column on {table.name} for the date range.")
        col = table.c[f.name]
        if filters.start:
            where.append(col >= datetime.fromisoformat(f"{filters.start}T00:00:00"))
        if filters.end:
            where.append(col <= datetime.fromisoformat(f"{filters.end}T23:59:59.999"))
    for name, values in (filters.enums or {}).items():
        if not values:
            continue  # "All"
        f = info.get(name)
        if f is None or f.type != "enum":
            raise ExportValidationError(f'"{name}" is not a status/category column on {table.name}.')
        bad = [v for v in values if v not in (f.enum_values or [])]
        if bad:
            raise ExportValidationError(f"Invalid {name} value(s): {', '.join(bad)}")
        col = table.c[name]
        where.append(col.overlap(values) if f.is_list else col.in_(values))
    if filters.ids:
        where.append(table.c[primary_key(m)].in_(filters.ids))
    return where


# --- CSV ----------------------------------------------------------------------------------------


def _iso(value: datetime) -> str:
    """JavaScript's toISOString(): UTC, milliseconds, Z."""
    if value.tzinfo is not None:
        value = value.astimezone(UTC).replace(tzinfo=None)
    return value.isoformat(timespec="milliseconds") + "Z"


def _js(value: Any) -> str:
    """String(value) as JavaScript writes it."""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float):
        return str(int(value)) if math.isfinite(value) and value.is_integer() else repr(value)
    if isinstance(value, enum.Enum):
        return str(value.value)
    if isinstance(value, datetime):
        return _iso(value)
    return str(value)


def _format(value: Any, is_json: bool) -> str:
    if value is None:
        return ""
    if is_json:
        return json.dumps(value, separators=(",", ":"), ensure_ascii=False, default=str)
    if isinstance(value, list):
        return "; ".join(_js(v) for v in value)
    return _js(value)


def _neutralize(text: str) -> str:
    """Against spreadsheet formula injection, without mangling "+254 700…"."""
    return f"'{text}" if re.match(r"^[=@\t\r]", text) or re.match(r"^[+-][^\d\s]", text) else text


def _cell(text: str) -> str:
    return '"' + text.replace('"', '""') + '"' if re.search(r'[",\n\r]', text) else text


def _csv(m: Mapper[Any], columns: list[str], rows: Iterable[Row]) -> str:
    info = {f.name: f for f in fields(m)}
    lines = [",".join(_cell(c) for c in columns)]
    for row in rows:
        out = []
        for c in columns:
            kind = info[c].type
            text = _format(row.get(c), kind == "Json")
            out.append(_cell(_neutralize(text) if kind in ("String", "Json") else text))
        lines.append(",".join(out))
    return UTF8_BOM + "\r\n".join(lines) + "\r\n"


def _relationships_csv(names: set[str]) -> str:
    lines = ["table,column,references_table,references_column,relationship"]
    for name in sorted(names):
        m = mapper(name)
        assert m is not None
        seen = set()
        for rel in relations(m):
            if rel.direction.name != "MANYTOONE" or rel.mapper.local_table.name not in names:
                continue
            joined = link(rel)
            row = (name, joined.parent_column, rel.mapper.local_table.name, joined.related_column, rel.key)
            if row not in seen:
                seen.add(row)
                lines.append(",".join(_cell(x) for x in row))
    return UTF8_BOM + "\r\n".join(lines) + "\r\n"


def _slug(text: str) -> str:
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", text.lower()))[:60] or "section"


def _table_files(folder: str, tables: TableSet) -> tuple[list[tuple[str, str]], dict[str, int]]:
    files, counts = [], {}
    for name in sorted(tables):
        m = mapper(name)
        assert m is not None
        entry = tables[name]
        columns = [f.name for f in fields(m) if f.name in entry.columns]
        files.append((f"{folder}{name}.csv", _csv(m, columns, entry.rows.values())))
        counts[name] = len(entry.rows)
    files.append((f"{folder}relationships.csv", _relationships_csv(set(tables))))
    return files, counts


# --- the export ------------------------------------------------------------------------------------


@dataclass(frozen=True)
class Actor:
    user_id: str
    role: Role
    name: str | None
    email: str | None


@dataclass
class Export:
    filename: str
    zip: bytes
    manifest: dict[str, Any]


def _role_label(role: Role) -> str:
    return "HR" if role is Role.hr else humanize(role.value)


def _readme(actor: Actor, full: bool, summary: list[dict[str, Any]], now: datetime) -> str:
    role = _role_label(actor.role)
    by = f"By: {actor.name or ''} {f'<{actor.email}>' if actor.email else ''} ({role})".strip()
    lines = [
        "VERTEX CRM - FULL BACKUP" if full else "VERTEX CRM - CUSTOM DATA EXPORT",
        "=" * 40,
        "",
        f"This is a COMPLETE backup of every table available to the {role} role:\nevery column and every row, with no filters applied." if full
        else "This is a CUSTOM export. It contains ONLY the tables, columns and filters that\nwere selected - it is NOT a complete backup of the CRM.",
        "",
        f"Generated: {_iso(now)}",
        by,
        "",
        "How to read it",
        "--------------",
        "- Each table is one CSV file, named after its database table.",
        "- Column names are the real database column names. Columns ending in _id link",
        "  rows across files; relationships.csv lists every such link in this export.",
        "- manifest.json records exactly what was selected (tables, columns, filters).",
        "",
    ]
    for s in summary:
        lines += ["Tables" if full else f"Section: {s['title']}  (folder {s['folder']})", "-" * 40]
        if not s["tables"]:
            lines.append("  (no rows matched)")
        lines += [f"  {table}.csv - {model_label(table)}: {count} row(s)" for table, count in s["tables"].items()]
        lines.append("")
    return "\r\n".join(lines)


def _zip(files: list[tuple[str, str]], now: datetime) -> bytes:
    buf = io.BytesIO()
    stamp = now.timetuple()[:6]
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, content in files:
            z.writestr(zipfile.ZipInfo(name, date_time=stamp), content.encode("utf-8"), compress_type=zipfile.ZIP_DEFLATED)
    return buf.getvalue()


def build_export(db: Session, actor: Actor, request: FullRequest | CustomRequest, now: datetime | None = None) -> Export:
    now = now or utc_now_ms()
    files: list[tuple[str, str]] = []
    summary: list[dict[str, Any]] = []
    if isinstance(request, FullRequest):
        tables: TableSet = {}
        for name in allowed_models(actor.role):
            m = mapper(name)
            assert m is not None
            _add(tables, m, _fetch(db, actor.role, m, []), _columns(m, None))
        out, counts = _table_files("", tables)
        files += out
        summary.append({"title": "Full backup", "folder": "", "tables": counts})
    else:
        for index, section in enumerate(request.sections):
            m = _require(actor.role, section.root.model)
            rows = _fetch(db, actor.role, m, _section_where(m, section.filters))
            tables = {}
            _collect(db, actor.role, section.root, rows, tables, 0)
            folder = f"{index + 1:02d}-{_slug(section.title)}/"
            out, counts = _table_files(folder, tables)
            files += out
            summary.append({"title": section.title, "folder": folder, "tables": counts})

    full = isinstance(request, FullRequest)
    manifest = {
        "export_type": "full_backup" if full else "custom_export",
        "generated_at": _iso(now),
        "generated_by": {"id": actor.user_id, "name": actor.name, "email": actor.email, "role": actor.role.value},
        "note": "Complete backup of every table this role can access — all columns, all rows." if full
        else "Custom export of selected tables, columns and filters only — NOT a complete backup.",
        "request": request.model_dump(exclude_none=True),
        "sections": summary,
    }
    files = [("README.txt", _readme(actor, full, summary, now)), ("manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False)), *files]
    name = f"vertex-{'full-backup' if full else 'custom-export'}_{now.date().isoformat()}.zip"
    return Export(name, _zip(files, now), manifest)
