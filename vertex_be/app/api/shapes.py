"""Prisma-shaped JSON for the reads the website made with nested selects
(reads handover R4 onwards): a row's chosen columns, with relations nested
as the select named them, so the website's pages read the same keys.

    pick(candidate, "id", "full_name", user=lambda u: pick(u, "full_name", "email"))

A date is written as Prisma writes it ("…T00:00:00.000Z": the pages read
it with new Date(), which takes one without the Z as local time), an enum
as its value; a missing relation is null. full() is every column.
"""

from __future__ import annotations

from app.db.base import SOFT_DELETE_COLUMNS

import enum
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import datetime
from typing import Any

Shape = Callable[[Any], Any]


def value(v: Any) -> Any:
    if isinstance(v, datetime):
        return v.isoformat(timespec="milliseconds") + "Z"
    if isinstance(v, enum.Enum):
        return v.value
    if isinstance(v, list):
        return [value(x) for x in v]
    return v


@dataclass(frozen=True)
class ordered:  # noqa: N801  (reads like a function at the call site)
    """A list relation's shape, ordered (Prisma's nested orderBy)."""

    shape: Shape
    key: str
    desc: bool = False


def pick(row: Any, *columns: str, **relations: Shape | ordered) -> dict[str, Any] | None:
    """The row's columns and relations, or None for no row. A relation is
    shaped by its function; a list relation by applying it to each item,
    in the order ordered() names (else as loaded)."""
    if row is None:
        return None
    out = {c: value(getattr(row, c)) for c in columns}
    for name, shape in relations.items():
        related = getattr(row, name)
        if isinstance(shape, ordered):
            related = sorted(related, key=lambda r: getattr(r, shape.key), reverse=shape.desc)
            shape = shape.shape
        out[name] = [shape(r) for r in related] if isinstance(related, list) else (shape(related) if related is not None else None)
    return out


def full(row: Any, **relations: Shape | ordered) -> dict[str, Any] | None:
    """Every column of the row (Prisma's include), plus relations."""
    if row is None:
        return None
    return pick(row, *(c.key for c in row.__table__.columns if c.key not in SOFT_DELETE_COLUMNS), **relations)


def each(shape: Shape, rows: Iterable[Any]) -> list[Any]:
    return [shape(r) for r in rows]
