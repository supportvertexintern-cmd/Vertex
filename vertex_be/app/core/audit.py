"""The audit trail (SRS NFR-6) for FastAPI's writes: auditedPrisma() and
recordSecurityEvent() in vertex/src/lib/audit.ts, in SQLAlchemy.

Data changes are recorded by a flush hook on every Session, so a write
can't silently skip the trail:

- Every create, update and delete of an audited model (AUDITED_MODELS, the
  same list as audit.ts) adds an AuditLog row with the before/after
  snapshots, the actor and the request ID, in the same transaction as the
  change. The change and its record commit together or not at all.
- The actor must be declared first: routes take AuditedDb (the caller's
  session) and system jobs call set_audit_actor(db, None). An audited
  write in a session without one raises AuditActorMissing.
- Bulk UPDATE/DELETE statements on audited tables bypass the hook, so they
  are refused; load the rows and change them instead. (SQL sent straight
  to the connection is not seen at all: code review covers that.) They
  raise AuditBypassRefused.

Snapshots never hold credentials: redact() from app/core/logging.py runs on
every one, and REDACTED_FIELDS drops named columns outright.

AuditLog rows are inserted without RETURNING: vertex_api may append to the
trail but not read it (db-roles.sql).
"""

from __future__ import annotations

import logging
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Annotated, Any

from fastapi import Depends
from sqlalchemy import event, insert, inspect
from sqlalchemy.orm import ORMExecuteState, Session
from sqlalchemy.orm.attributes import NO_VALUE

from app.core.auth import AuthUser, current_user
from app.core.logging import REDACTED, log_event, redact, request_id_var
from app.db.base import new_id
from app.db.session import engine, get_db
from app.models.audit import AuditLog

AUDITED_MODELS: frozenset[str] = frozenset(
    {
        "Candidate",
        "Application",
        "Document",
        "User",
        "Report",
        "Campaign",
        "Case",
        "CaseStageEvent",
        "Contract",
        "CasePayment",
        "FeePolicy",
        "RetentionFollowUp",
        "Partner",
        "EmployerClient",
        "PartnerCandidate",
        "DocumentRequirementType",
        "RecruiterTarget",
        "RecruiterNote",
        "CandidateMessage",
        "InhouseCountryAssignment",
        "StaffKpiTarget",
        "ReferralAgent",
        "ReferralCommission",
        "ReferralCommissionRule",
        "ReferralAgentTarget",
        # FastAPI-owned reference data, content and jobs (steps 2.1-3.3): every
        # write FastAPI makes is on the trail.
        "Region",
        "Country",
        "Sector",
        "CountryDocumentRequirement",
        "SystemSetting",
        "KnowledgeArticle",
        "EmailTemplate",
        "Job",
        "JobPaymentStage",
        "JobSector",
        "JobPosition",
    }
)

# Never copied into the trail, even though the model is audited: "the
# password changed" is the row itself, not the hash.
REDACTED_FIELDS: dict[str, frozenset[str]] = {"User": frozenset({"password_hash"})}

_ACTOR = "audit_actor"


class AuditActorMissing(RuntimeError):
    pass


class AuditBypassRefused(RuntimeError):
    pass


def set_audit_actor(db: Session, actor_id: str | None) -> Session:
    """Declares who this session's writes are for; None is the system."""
    db.info[_ACTOR] = actor_id
    return db


def audited_db(user: Annotated[AuthUser, Depends(current_user)], db: Annotated[Session, Depends(get_db)]) -> Session:
    return set_audit_actor(db, user.user_id)


# The session for a route that writes: authenticated, with the caller as actor.
AuditedDb = Annotated[Session, Depends(audited_db)]


def _json(value: Any) -> Any:
    # Shaped like Prisma's JSON, so both services' rows read the same.
    if isinstance(value, datetime):
        return value.isoformat(timespec="milliseconds") + ("Z" if value.tzinfo is None else "")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, Decimal):
        return str(value)
    return value


def snapshot(obj: Any, *, before: bool = False) -> dict[str, Any]:
    """The row's loaded columns (or, with before=True, their values as of
    the last load), redacted. Never loads anything: this runs mid-flush."""
    state = inspect(obj)
    table = state.mapper.local_table.name
    out: dict[str, Any] = {}
    for col in state.mapper.column_attrs:
        attr = state.attrs[col.key]
        if before and attr.history.deleted:
            value = attr.history.deleted[0]
        else:
            value = attr.loaded_value
        if value is NO_VALUE:
            continue
        out[col.key] = _json(value)
    out = redact(out)
    for field in REDACTED_FIELDS.get(table, ()):
        if field in out:
            out[field] = REDACTED
    return out


def _table(obj: Any) -> str:
    return inspect(obj).mapper.local_table.name


def _entity_id(obj: Any) -> str:
    # The primary key, whatever its column: SystemSetting's is "key" and
    # EmailTemplate's "event", not "id".
    state = inspect(obj)
    values = state.identity or state.mapper.primary_key_from_instance(obj)
    return "/".join(str(v) for v in values if v is not None) or "unknown"


@event.listens_for(Session, "after_flush")
def _record_changes(db: Session, _flush_context: Any) -> None:
    changes = [("create", o) for o in db.new] + [("update", o) for o in db.dirty] + [("delete", o) for o in db.deleted]
    rows = []
    for action, obj in changes:
        table = _table(obj)
        if table not in AUDITED_MODELS:
            continue
        if action == "update" and not db.is_modified(obj, include_collections=False):
            continue
        if _ACTOR not in db.info:
            raise AuditActorMissing(f"{action} on {table} with no audit actor: use AuditedDb or set_audit_actor()")
        actor_id = db.info[_ACTOR]
        before = snapshot(obj, before=True) if action != "create" else None
        after = snapshot(obj) if action != "delete" else None
        entity_id = _entity_id(obj)
        rows.append(
            {
                "id": new_id(),
                "entity_type": table,
                "entity_id": entity_id,
                "action": action,
                "actor_id": actor_id,
                "request_id": request_id_var.get(),
                "before": before,
                "after": after,
            }
        )
        if table == "User" and action != "delete":
            was = (before or {}).get("role")
            now = (after or {}).get("role")
            if now == "admin" and was != "admin":
                log_event(logging.WARNING, "security.privilege_granted", actor_id=actor_id, user_id=entity_id, was=was, now=now)
    if rows:
        # Core insert, no RETURNING (vertex_api can't read AuditLog). A
        # failure here fails the flush, so the change isn't committed.
        db.connection().execute(insert(AuditLog.__table__), rows)


@event.listens_for(Session, "do_orm_execute")
def _refuse_bulk_writes(state: ORMExecuteState) -> None:
    if not (state.is_update or state.is_delete):
        return
    mapper = state.bind_mapper
    if mapper is not None and mapper.local_table.name in AUDITED_MODELS:
        raise AuditBypassRefused(
            f"bulk {'UPDATE' if state.is_update else 'DELETE'} on {mapper.local_table.name} skips the audit trail: "
            "load the rows and change them instead"
        )


SECURITY_INFO_ACTIONS = frozenset({"login_succeeded", "logout", "document_link_issued", "document_downloaded", "sessions_revoked"})


def record_security_event(
    action: str,
    *,
    actor_id: str | None,
    entity_type: str,
    entity_id: str,
    detail: dict[str, Any] | None = None,
) -> None:
    """recordSecurityEvent(): logs security.<action> and appends it to the
    trail in a transaction of its own, so a refused request (rolled back)
    still leaves its record. Never raises and never changes the outcome the
    caller decided; a failed write is logged as audit.write_failed."""
    try:
        detail = redact(detail or {})
        request_id = request_id_var.get()
        entity_id = (entity_id or "unknown")[:200]
        level = logging.INFO if action in SECURITY_INFO_ACTIONS else logging.WARNING
        log_event(level, f"security.{action}", actor_id=actor_id, entity_type=entity_type, entity_id=entity_id, **detail)
        try:
            with engine.begin() as conn:
                conn.execute(
                    insert(AuditLog.__table__),
                    {
                        "id": new_id(),
                        "entity_type": entity_type,
                        "entity_id": entity_id,
                        "action": action,
                        "actor_id": actor_id,
                        "request_id": request_id,
                        "after": detail,
                    },
                )
        except Exception as err:  # noqa: BLE001
            log_event(logging.ERROR, "audit.write_failed", action=action, request_id=request_id, error=type(err).__name__)
    except Exception:  # noqa: BLE001
        pass
