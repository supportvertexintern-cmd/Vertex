from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import Index
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, created_at_col, pk


class AuditLog(Base):
    """Append-only: a database trigger rejects UPDATE and DELETE (see the
    baseline migration). actor_id is intentionally not a FK so the trail
    survives user deletion."""

    __tablename__ = "AuditLog"
    __table_args__ = (
        Index("AuditLog_entity_type_entity_id_idx", "entity_type", "entity_id"),
        Index("AuditLog_action_created_at_idx", "action", "created_at"),
    )

    id: Mapped[str] = pk()
    entity_type: Mapped[str]
    entity_id: Mapped[str]
    action: Mapped[str]  # create | update | delete | verify | approve
    actor_id: Mapped[str | None] = mapped_column(index=True)
    before: Mapped[dict[str, Any] | None]
    after: Mapped[dict[str, Any] | None]
    created_at: Mapped[datetime] = created_at_col(index=True)
    # X-Request-ID of the request that wrote the row (Phase 10 correlation).
    request_id: Mapped[str | None] = mapped_column(index=True)
