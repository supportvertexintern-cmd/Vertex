"""Which roles hold which permissions (role management, 2026-11-21).

One row per tick on the admin's Roles & permissions page: role holds
permission. Unticking deletes the row (softly, as everything: the trail
and the row's deleted_at keep who held it and until when). The
permissions themselves, and the rules for who may hold one, are
app/core/permissions.py; admin holds everything and has no rows.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, SoftDeletable, created_at_col, enum_col, fk, pk
from app.models.enums import Role


class RolePermission(SoftDeletable, Base):
    __tablename__ = "RolePermission"

    id: Mapped[str] = pk()
    role: Mapped[Role] = enum_col(Role)
    permission: Mapped[str]  # a Permission value, e.g. "landing.publish"
    granted_by: Mapped[str | None] = mapped_column(fk("User.id", "SET NULL"))  # None: the migration's defaults
    created_at: Mapped[datetime] = created_at_col()
