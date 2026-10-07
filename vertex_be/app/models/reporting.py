from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import Index, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, created_at_col, enum_col, fk, pk, updated_at_col
from app.models.candidate import Candidate
from app.models.enums import (
    CorrectiveActionStatus,
    EscalationLevel,
    ExceptionCategory,
    ExceptionDecision,
    ExceptionStatus,
    ReportCycle,
    ReportStatus,
    Role,
    ScopeLevel,
    ScorecardStatus,
)
from app.models.identity import Country, User


class Report(Base):
    """A recruiter's submission rolls up via parent_report_id into their
    supervisor's country report (and on into an in-house report). `content`
    is a point-in-time snapshot taken at submission (FR-3.4) — it must not
    change when the underlying candidates move on."""

    __tablename__ = "Report"
    __table_args__ = (
        Index("Report_type_period_start_idx", "type", "period_start"),
        Index("Report_country_id_type_period_end_idx", "country_id", "type", "period_end"),
    )

    id: Mapped[str] = pk()
    type: Mapped[ReportCycle] = enum_col(ReportCycle)
    scope_level: Mapped[ScopeLevel] = enum_col(ScopeLevel)
    country_id: Mapped[str | None] = mapped_column(fk("Country.id", "SET NULL"), index=True)
    submitted_by: Mapped[str] = mapped_column(fk("User.id", "CASCADE"), index=True)
    period_start: Mapped[datetime]
    period_end: Mapped[datetime]
    status: Mapped[ReportStatus] = enum_col(ReportStatus, default=ReportStatus.draft, index=True)
    content: Mapped[dict[str, Any]]
    return_reason: Mapped[str | None]
    parent_report_id: Mapped[str | None] = mapped_column(fk("Report.id", "SET NULL"))
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    country: Mapped[Country | None] = relationship()
    submitter: Mapped[User] = relationship()
    parent_report: Mapped[Report | None] = relationship(
        remote_side="Report.id", back_populates="child_reports"
    )
    child_reports: Mapped[list[Report]] = relationship(back_populates="parent_report")


class ExceptionReport(Base):
    """Supervisory Reporting Framework §6 — raised ad hoc by any tier and
    escalated independently up regional → country → inhouse → management.
    (Python class name avoids shadowing the builtin; the table is "Exception".)"""

    __tablename__ = "Exception"

    id: Mapped[str] = pk()
    reference: Mapped[str] = mapped_column(unique=True)  # "EXC-000123"
    category: Mapped[ExceptionCategory] = enum_col(ExceptionCategory)
    raised_by: Mapped[str] = mapped_column(fk("User.id", "CASCADE"), index=True)
    # Snapshot — a later role change must not rewrite which tier raised it.
    role_at_raise: Mapped[Role] = enum_col(Role)
    country_id: Mapped[str | None] = mapped_column(fk("Country.id", "SET NULL"), index=True)
    candidate_id: Mapped[str | None] = mapped_column(fk("Candidate.id", "SET NULL"))
    reference_note: Mapped[str | None]
    issue_statement: Mapped[str]
    immediate_impact: Mapped[str]
    actions_taken: Mapped[str | None]
    root_cause: Mapped[str | None]
    options_considered: Mapped[str | None]
    recommendation: Mapped[str | None]
    decision_required: Mapped[str]
    decision_deadline: Mapped[datetime]
    escalation_level: Mapped[EscalationLevel] = enum_col(
        EscalationLevel, default=EscalationLevel.regional, index=True
    )
    status: Mapped[ExceptionStatus] = enum_col(
        ExceptionStatus, default=ExceptionStatus.open, index=True
    )
    decision: Mapped[ExceptionDecision | None] = enum_col(ExceptionDecision)
    decision_notes: Mapped[str | None]
    decided_by: Mapped[str | None] = mapped_column(fk("User.id", "SET NULL"))
    decided_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    raiser: Mapped[User] = relationship(foreign_keys=[raised_by])
    decider: Mapped[User | None] = relationship(foreign_keys=[decided_by])
    country: Mapped[Country | None] = relationship()
    candidate: Mapped[Candidate | None] = relationship()
    corrective_actions: Mapped[list[ExceptionCorrectiveAction]] = relationship(
        back_populates="exception", cascade="all, delete-orphan"
    )


class ExceptionCorrectiveAction(Base):
    __tablename__ = "ExceptionCorrectiveAction"

    id: Mapped[str] = pk()
    exception_id: Mapped[str] = mapped_column(fk("Exception.id", "CASCADE"), index=True)
    action: Mapped[str]
    owner_id: Mapped[str | None] = mapped_column(fk("User.id", "SET NULL"), index=True)
    due_date: Mapped[datetime | None]
    success_measure: Mapped[str | None]
    status: Mapped[CorrectiveActionStatus] = enum_col(
        CorrectiveActionStatus, default=CorrectiveActionStatus.open
    )
    evidence: Mapped[str | None]
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    exception: Mapped[ExceptionReport] = relationship(back_populates="corrective_actions")
    owner: Mapped[User | None] = relationship()


class StaffScorecard(Base):
    """Framework §7 monthly performance review, authored by the direct
    supervisor, never self-submitted. Category/action are stored at
    finalization so later threshold changes don't rewrite history."""

    __tablename__ = "StaffScorecard"
    __table_args__ = (UniqueConstraint("staff_id", "period_month"),)

    id: Mapped[str] = pk()
    staff_id: Mapped[str] = mapped_column(fk("User.id", "CASCADE"), index=True)
    reviewer_id: Mapped[str] = mapped_column(fk("User.id", "CASCADE"), index=True)
    period_month: Mapped[datetime]  # first-of-month marker
    status: Mapped[ScorecardStatus] = enum_col(ScorecardStatus, default=ScorecardStatus.draft)
    overall_score: Mapped[float | None]
    performance_category: Mapped[str | None]
    required_action: Mapped[str | None]
    review_date: Mapped[datetime | None]
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    staff: Mapped[User] = relationship(foreign_keys=[staff_id])
    reviewer: Mapped[User] = relationship(foreign_keys=[reviewer_id])
    areas: Mapped[list[StaffScorecardArea]] = relationship(
        back_populates="scorecard", cascade="all, delete-orphan"
    )


class StaffScorecardArea(Base):
    __tablename__ = "StaffScorecardArea"
    __table_args__ = (UniqueConstraint("scorecard_id", "area_key"),)

    id: Mapped[str] = pk()
    scorecard_id: Mapped[str] = mapped_column(fk("StaffScorecard.id", "CASCADE"))
    area_key: Mapped[str]
    weight: Mapped[float]
    rating: Mapped[int | None]
    evidence: Mapped[str | None]

    scorecard: Mapped[StaffScorecard] = relationship(back_populates="areas")


class StaffKpiTarget(Base):
    """A supervisor's target for a direct report, keyed to the exact KPI row
    label the recipient's own report uses for that cycle."""

    __tablename__ = "StaffKpiTarget"
    __table_args__ = (UniqueConstraint("staff_id", "cycle", "kpi_label"),)

    id: Mapped[str] = pk()
    staff_id: Mapped[str] = mapped_column(fk("User.id", "CASCADE"), index=True)
    cycle: Mapped[ReportCycle] = enum_col(ReportCycle)
    kpi_label: Mapped[str]
    target_value: Mapped[float]
    # NOT NULL yet ON DELETE SET NULL in the inherited schema, so deleting the
    # setter fails — kept as-is to match the database.
    set_by: Mapped[str] = mapped_column(fk("User.id", "SET NULL"))
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    staff: Mapped[User] = relationship(foreign_keys=[staff_id])
    setter: Mapped[User] = relationship(foreign_keys=[set_by])


class RecruiterNote(Base):
    """A Country Supervisor's one-way note to one of their recruiters."""

    __tablename__ = "RecruiterNote"

    id: Mapped[str] = pk()
    recruiter_id: Mapped[str] = mapped_column(fk("User.id", "CASCADE"), index=True)
    author_id: Mapped[str] = mapped_column(fk("User.id", "CASCADE"))
    message: Mapped[str]
    created_at: Mapped[datetime] = created_at_col()

    recruiter: Mapped[User] = relationship(foreign_keys=[recruiter_id])
    author: Mapped[User] = relationship(foreign_keys=[author_id])
