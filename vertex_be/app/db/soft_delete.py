"""Soft delete: nothing a user deletes leaves the database (owner's decision,
2026-11-06; docs/architecture/soft-delete.md). Every route keeps calling
db.delete(); the hooks here turn that into setting deleted_at, in one place, so
no route or query can forget.

- Reading: every ORM SELECT leaves out deleted rows, wherever the table appears
  (joins, subqueries, relationships, counts). The one way to see them is
  .execution_options(include_deleted=True). SQL that isn't ORM-aware doesn't go
  through this: the backup export filters for itself.
- Deleting: what Postgres did through the foreign keys happens here instead,
  because no row is removed for it to act on, so behaviour stays the same:
    CASCADE   the children are soft deleted too, at the same deleted_at;
    SET NULL  the link is cleared, and saved on the deleted row (deleted_links)
              so a restore can put it back;
    RESTRICT  a live child refuses the delete with the same IntegrityError
              (23503) Postgres raised, so each route's 409 still works.
- Exempt: AuditLog, append-only already, and RefreshToken, whose rows are
  credentials. A deleted user's sessions really end.
- The trail records the delete as "delete" (app/core/audit.py). Stored files
  are kept: the only ones removed are of an upload that failed to save.
- A real DELETE of a soft-deletable row raises HardDeleteRefused, so a path
  this misses (a row dropped from a delete-orphan collection) fails loudly
  instead of destroying data.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import event, inspect, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapper, ORMExecuteState, Session, with_loader_criteria

from app.core.clock import utc_now_ms
from app.db.base import Base, SoftDeletable

SOFT_DELETED = "soft_deleted_objects"


class HardDeleteRefused(RuntimeError):
    pass


class _StillReferenced(Exception):
    """Reads like psycopg2's error where the routes check err.orig.pgcode."""

    pgcode = "23503"


@event.listens_for(Session, "do_orm_execute")
def _hide_deleted(state: ORMExecuteState) -> None:
    if state.is_select and not state.is_column_load and not state.execution_options.get("include_deleted", False):
        state.statement = state.statement.options(
            with_loader_criteria(
                SoftDeletable,
                lambda cls: cls.deleted_at.is_(None),
                include_aliases=True,
                propagate_to_loaders=True,
                track_closure_variables=False,
            )
        )


def _referencing(table: Any) -> list[tuple[Any, Mapper[Any]]]:
    """Every foreign key pointing at this table, with the model holding it."""
    found = []
    for mapper in Base.registry.mappers:
        for key in mapper.local_table.foreign_keys:
            if key.column.table is table:
                found.append((key, mapper))
    return found


def _mark(db: Session, obj: Any, at: Any, pending: set[Any], seen: dict[Any, None], hard: list[Any]) -> None:
    if obj in seen:
        return
    seen[obj] = None
    mapper = inspect(obj).mapper
    links: dict[str, list[str]] = {}
    for key, child_mapper in _referencing(mapper.local_table):
        value = getattr(obj, mapper.get_property_by_column(key.column).key)
        attr = child_mapper.get_property_by_column(key.parent).key
        children = db.scalars(select(child_mapper.class_).where(getattr(child_mapper.class_, attr) == value)).all()
        rule = (key.ondelete or "NO ACTION").upper()
        if rule in ("RESTRICT", "NO ACTION"):
            if children:
                raise IntegrityError(
                    f"soft delete of {mapper.local_table.name}",
                    {},
                    _StillReferenced(f"{child_mapper.local_table.name}.{attr} still references it"),
                )
        elif rule == "CASCADE":
            for child in children:
                if isinstance(child, SoftDeletable):
                    _mark(db, child, at, pending, seen, hard)
                else:
                    hard.append(child)
        elif rule == "SET NULL":
            for child in children:
                if child is obj or child in pending or child in seen:
                    continue  # going too: it keeps its link for a restore
                setattr(child, attr, None)
                links.setdefault(f"{child_mapper.local_table.name}.{attr}", []).append(inspect(child).identity[0])
    obj.deleted_at = at
    obj.deleted_links = links or None


@event.listens_for(Session, "before_flush")
def _soft_delete(db: Session, _context: Any, _instances: Any) -> None:
    pending = {o for o in db.deleted if isinstance(o, SoftDeletable)}
    if not pending:
        return
    at = utc_now_ms()
    seen: dict[Any, None] = {}
    hard: list[Any] = []
    # No autoflush: the checks must see the database as it was, so a RESTRICT
    # child this same delete cascades to still refuses it, as it did in Postgres.
    with db.no_autoflush:
        for obj in pending:
            _mark(db, obj, at, pending, seen, hard)
    # add() takes a row out of session.deleted, so it's updated, not deleted.
    # The exempt children go last: it cascades, and would save them too.
    for obj in seen:
        db.add(obj)
    for child in hard:
        db.delete(child)
    db.info.setdefault(SOFT_DELETED, {}).update({id(o): o for o in seen})


@event.listens_for(Session, "after_flush_postexec")
def _forget_soft_deleted(db: Session, _context: Any) -> None:
    # Out of the identity map, or db.get() would still return it.
    for obj in db.info.pop(SOFT_DELETED, {}).values():
        if obj in db:
            db.expunge(obj)


@event.listens_for(SoftDeletable, "before_delete", propagate=True)
def _refuse_hard_delete(_mapper: Mapper[Any], _connection: Any, target: Any) -> None:
    raise HardDeleteRefused(
        f"{type(target).__name__} is soft deleted: call db.delete(row), and don't drop it from a collection"
    )
