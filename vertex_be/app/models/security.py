from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import Index
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, created_at_col, enum_col, fk, pk
from app.models.enums import SecurityAlertSeverity, SecurityAlertStatus


class SecurityAlert(Base):
    """An alert the security monitor raised (app/services/security_monitor.py),
    as a row for Admin -> Monitoring -> Suspicious Activity (migration 0013).
    The monitor inserts it alongside the trail's alert_raised row and the
    email; admins move it from open to reviewing, resolved or dismissed,
    each change audited with who, when and the note. Never deleted."""

    __tablename__ = "SecurityAlert"
    __table_args__ = (
        Index("SecurityAlert_status_created_at_idx", "status", "created_at"),
        Index("SecurityAlert_user_id_idx", "user_id"),
        Index("SecurityAlert_rule_idx", "rule"),
        Index("SecurityAlert_created_at_idx", "created_at"),
    )

    id: Mapped[str] = pk()
    # The monitor's rule (brute_force_account, refresh_token_reused, ...) and
    # its dedupe key, which matches the trail's alert_raised entity_id.
    rule: Mapped[str]
    alert_key: Mapped[str]
    severity: Mapped[SecurityAlertSeverity] = enum_col(SecurityAlertSeverity)
    summary: Mapped[str]
    # The account it is about, when one is known.
    user_id: Mapped[str | None] = mapped_column(fk("User.id", "SET NULL"))
    ip: Mapped[str | None]
    detail: Mapped[dict[str, Any] | None]
    status: Mapped[SecurityAlertStatus] = enum_col(SecurityAlertStatus, default=SecurityAlertStatus.open)
    reviewed_by: Mapped[str | None] = mapped_column(fk("User.id", "SET NULL"))
    reviewed_at: Mapped[datetime | None]
    note: Mapped[str | None]
    created_at: Mapped[datetime] = created_at_col()
