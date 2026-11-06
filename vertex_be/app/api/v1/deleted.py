"""Soft deleted records, for admins: what's been deleted, and bringing it back
(docs/architecture/soft-delete.md). Restoring is audited as "restore". Only
admins, and only here: every other query leaves deleted rows out."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import inspect, select
from sqlalchemy.exc import IntegrityError

from app.core.api import ApiError, Data, UtcDateTime
from app.core.audit import AuditedDb
from app.core.auth import AuthUser
from app.core.rbac import require_role
from app.db.base import Base, SoftDeletable
from app.db.soft_delete import RestoreRefused, restore
from app.models.candidate import Document
from app.models.enums import Role

router = APIRouter()

Admin = Annotated[AuthUser, Depends(require_role(Role.admin))]

# What the list shows to tell one record from another: the first of these.
LABELS = ("full_name", "name", "title", "label", "email", "reference", "key", "event", "subject", "type")
REPEATABLE_TYPE = "other"  # app/api/v1/documents.py: any number per owner


def _models() -> dict[str, type[Any]]:
    return {m.local_table.name: m.class_ for m in Base.registry.mappers if issubclass(m.class_, SoftDeletable)}


class DeletedRow(BaseModel):
    table: str
    id: str
    label: str | None
    deleted_at: UtcDateTime


class Restored(BaseModel):
    table: str
    id: str
    restored: int


def _label(row: Any) -> str | None:
    for field in LABELS:
        value = getattr(row, field, None)
        if value is not None:
            return str(getattr(value, "value", value))
    return None


@router.get("/deleted", response_model=Data[list[DeletedRow]])
def list_deleted(
    _admin: Admin,
    db: AuditedDb,
    table: str | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
):
    """The most recently deleted records, newest first, of one table or all."""
    models = _models()
    if table is not None and table not in models:
        raise ApiError(404, "not_found", "No such table.")
    found: list[tuple[datetime, str, Any]] = []
    for name in [table] if table else sorted(models):
        model = models[name]
        rows = db.scalars(
            select(model)
            .where(model.deleted_at.is_not(None))
            .order_by(model.deleted_at.desc())
            .limit(limit)
            .execution_options(include_deleted=True)
        )
        found += [(r.deleted_at, name, r) for r in rows]
    found.sort(key=lambda item: item[0], reverse=True)
    return {
        "data": [
            {"table": name, "id": str(inspect(row).identity[0]), "label": _label(row), "deleted_at": at}
            for at, name, row in found[:limit]
        ]
    }


@router.post("/deleted/{table}/{row_id}/restore", response_model=Data[Restored])
def restore_deleted(table: str, row_id: str, _admin: Admin, db: AuditedDb):
    """The record and everything deleted with it come back, and the links its
    delete cleared are put back where they're still empty. Refused if a record
    it needs is still deleted, or a unique value has been taken since. A user's
    sessions ended for good, so they sign in again. Its stored files were kept."""
    model = _models().get(table)
    if model is None:
        raise ApiError(404, "not_found", "No such table.")
    row = db.scalar(
        select(model)
        .where(inspect(model).primary_key[0] == row_id, model.deleted_at.is_not(None))
        .execution_options(include_deleted=True)
    )
    if row is None:
        raise ApiError(404, "not_found", "No deleted record with that id.")
    if isinstance(row, Document) and row.type != REPEATABLE_TYPE:
        owner = (Document.candidate_id == row.candidate_id, Document.partner_candidate_id == row.partner_candidate_id)
        if db.scalar(select(Document.id).where(*owner, Document.type == row.type)) is not None:
            raise ApiError(409, "replaced", "A newer document of this type has replaced it.")
    try:
        count = restore(db, row)
        db.commit()
    except RestoreRefused as err:
        db.rollback()
        raise ApiError(409, "needs_restore_first", str(err)) from None
    except IntegrityError:
        db.rollback()
        raise ApiError(409, "unique_taken", "A live record now has the same unique value, such as an email or name.") from None
    return {"data": {"table": table, "id": row_id, "restored": count}}
