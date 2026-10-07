"""Declarative base and column helpers.

The schema is owned by this codebase (Alembic) but was originally created
by Prisma, so everything here reproduces Prisma's physical conventions
exactly: PascalCase quoted table names, text cuid primary keys,
timestamp(3) without time zone, `<Table>_<cols>_idx/_key/_fkey` constraint
names, and ON UPDATE CASCADE on every foreign key. `alembic check` against
the live database is the proof that models and tables still agree.
"""

import enum
import secrets
import string
import time
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    Double,
    Enum,
    ForeignKey,
    Integer,
    MetaData,
    Text,
    false,
    func,
    true,
)
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP
from sqlalchemy.orm import DeclarativeBase, mapped_column

NAMING_CONVENTION = {
    "pk": "%(table_name)s_pkey",
    "ix": "%(table_name)s_%(column_0_N_name)s_idx",
    "uq": "%(table_name)s_%(column_0_N_name)s_key",
    "fk": "%(table_name)s_%(column_0_name)s_fkey",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)
    type_annotation_map = {
        str: Text(),
        int: Integer(),
        float: Double(),
        bool: Boolean(),
        datetime: TIMESTAMP(precision=3),
        dict[str, Any]: JSONB(),
    }


_BASE36 = string.digits + string.ascii_lowercase


def _to_base36(n: int) -> str:
    out = ""
    while n:
        n, r = divmod(n, 36)
        out = _BASE36[r] + out
    return out or "0"


def new_id() -> str:
    """cuid-shaped id ("c" + base36 millis + random), sortable by creation
    time like the cuids Prisma already wrote into existing rows."""
    millis = _to_base36(time.time_ns() // 1_000_000)
    rand = "".join(secrets.choice(_BASE36) for _ in range(16))
    return f"c{millis}{rand}"


def pk():
    return mapped_column(Text, primary_key=True, default=new_id)


def fk(target: str, ondelete: str, *, name: str | None = None) -> ForeignKey:
    return ForeignKey(target, ondelete=ondelete, onupdate="CASCADE", name=name)


def created_at_col(**kw):
    return mapped_column(server_default=func.current_timestamp(), **kw)


def updated_at_col(**kw):
    return mapped_column(
        server_default=func.current_timestamp(),
        onupdate=func.current_timestamp(),
        **kw,
    )


def flag(default: bool, **kw):
    return mapped_column(
        default=default, server_default=true() if default else false(), **kw
    )


def pg_enum(enum_cls: type[enum.Enum]) -> Enum:
    # Postgres type names are the Prisma enum names ("Role", "CaseStage"…),
    # which is why every Python enum class is named identically.
    return Enum(
        enum_cls,
        name=enum_cls.__name__,
        values_callable=lambda e: [m.value for m in e],
        validate_strings=True,
    )


def enum_col(enum_cls: type[enum.Enum], default: enum.Enum | None = None, **kw):
    if default is not None:
        kw.setdefault("default", default)
        kw.setdefault("server_default", default.value)
    return mapped_column(pg_enum(enum_cls), **kw)
