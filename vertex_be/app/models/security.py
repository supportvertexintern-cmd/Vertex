from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import Index, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, created_at_col, enum_col, flag, fk, pk
from app.models.enums import LockoutEnd, SecurityAlertSeverity, SecurityAlertStatus


class SecurityAlert(Base):
    """An alert the security monitor raised (app/services/security_monitor.py),
    as a row for Admin -> Monitoring -> Suspicious Activity (migration 0013).
    The monitor inserts it alongside the trail's alert_raised row and the
    email; admins move it from open to reviewing, resolved or dismissed,
    each change audited with who, when and the note. No route deletes one;
    the daily retention clean-up does, after SECURITY_RETENTION_MONTHS (D3,
    exceptions.md E11), each delete on the trail."""

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


class LoginLockout(Base):
    """One sign-in lockout (login protection, PR 1, migration 0017): an
    account, known by its email's fingerprint as the failure counter knows
    it, held after too many failed sign-ins. While a row is open (no
    ended_at) and locked_until is ahead, sign-in to that address is refused.
    The cooldown grows with each lockout in a row (step 1 to 4); step 4
    flags it for an admin's review. Kept as history, and deleted by the
    retention clean-up after SECURITY_RETENTION_MONTHS (D3). Audited: the
    unlock, the review and the expiry are on the trail with who and why."""

    __tablename__ = "LoginLockout"
    __table_args__ = (
        Index("LoginLockout_email_fp_locked_at_idx", "email_fp", "locked_at"),
        Index("LoginLockout_user_id_idx", "user_id"),
        Index("LoginLockout_needs_review_idx", "needs_review", postgresql_where=text("needs_review")),
        # At most one open lockout per address: two workers locking it at
        # once can't both write one.
        Index("LoginLockout_one_open_idx", "email_fp", unique=True, postgresql_where=text("ended_at IS NULL")),
    )

    id: Mapped[str] = pk()
    email_fp: Mapped[str]
    # The account, when the address has one.
    user_id: Mapped[str | None] = mapped_column(fk("User.id", "SET NULL"))
    step: Mapped[int]
    locked_at: Mapped[datetime]
    locked_until: Mapped[datetime]
    failures: Mapped[int]
    last_ip: Mapped[str | None]
    last_country: Mapped[str | None]
    # When the owner was emailed about it (at most once a day per account).
    notice_sent_at: Mapped[datetime | None]
    ended_at: Mapped[datetime | None]
    ended_by: Mapped[LockoutEnd | None] = enum_col(LockoutEnd, nullable=True)
    ended_by_user_id: Mapped[str | None] = mapped_column(fk("User.id", "SET NULL"))
    end_reason: Mapped[str | None]
    # An admin unlock or a password reset after this lockout had already
    # expired: the next lockout is step 1 again.
    steps_reset_at: Mapped[datetime | None]
    needs_review: Mapped[bool] = flag(False)
    reviewed_at: Mapped[datetime | None]
    reviewed_by: Mapped[str | None] = mapped_column(fk("User.id", "SET NULL"))
    review_note: Mapped[str | None]
