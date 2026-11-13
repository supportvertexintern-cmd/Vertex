"""Partner tracking and commission management (Phase 6, 2026-11-01).

The virtual assistants (Role.virtual_assistant) look after partner agencies:
their onboarding (MOU, SLA, documents), their reports and the follow-ups the
team owes them. Partners earn commissions on the candidates they bring, and
Vertex records its own administrative fees on the same candidates, in a
separate ledger.

- PartnerCommissionRule: the two amounts (registration, and each month after
  deployment), editable by an admin; global, not per country.
- PartnerCommission: one row per commission earned. period is
  "registration", or "YYYY-MM" for each of the six months after deployment;
  never null, so the unique rule makes earning idempotent.
- AdminFee: Vertex's own fee per application ("application") and per month
  after deployment, the same idempotency shape.
- PartnerReport: what a partner reported, entered by the team on its behalf.
- PartnerFollowUp: an action the team owes a partner. The automatic "needs a
  follow-up" flags (an unsigned agreement, a report outstanding) are worked
  out on read, not stored.

Money is exact: Numeric(12, 2).
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import Index, Numeric
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, SoftDeletable, created_at_col, enum_col, fk, pk, updated_at_col
from app.models.candidate import Candidate
from app.models.cases import Case
from app.models.enums import AdminFeeType, CommissionStatus, PartnerCommissionRuleType, PartnerFollowUpStatus, PartnerReportStatus
from app.models.identity import User
from app.models.partners import Partner


def money():
    return mapped_column(Numeric(12, 2))


class PartnerCommissionRule(SoftDeletable, Base):
    """One row per rule type: USD 10 per registered candidate, USD 40 a month
    for six months per deployed candidate, until an admin changes them."""

    __tablename__ = "PartnerCommissionRule"

    id: Mapped[str] = pk()
    rule_type: Mapped[PartnerCommissionRuleType] = enum_col(PartnerCommissionRuleType)
    amount: Mapped[Decimal] = money()
    currency: Mapped[str] = mapped_column(default="USD", server_default="USD")
    updated_by: Mapped[str | None] = mapped_column(fk("User.id", "SET NULL"))
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    updater: Mapped[User | None] = relationship()


class PartnerCommission(SoftDeletable, Base):
    __tablename__ = "PartnerCommission"
    __table_args__ = (
        Index("PartnerCommission_partner_id_idx", "partner_id"),
        Index("PartnerCommission_candidate_id_idx", "candidate_id"),
        Index("PartnerCommission_status_idx", "status"),
    )

    id: Mapped[str] = pk()
    partner_id: Mapped[str] = mapped_column(fk("Partner.id", "CASCADE"))
    candidate_id: Mapped[str] = mapped_column(fk("Candidate.id", "CASCADE"))
    case_id: Mapped[str | None] = mapped_column(fk("Case.id", "SET NULL"))
    rule_type: Mapped[PartnerCommissionRuleType] = enum_col(PartnerCommissionRuleType)
    period: Mapped[str]
    amount: Mapped[Decimal] = money()
    currency: Mapped[str] = mapped_column(default="USD", server_default="USD")
    status: Mapped[CommissionStatus] = enum_col(CommissionStatus, default=CommissionStatus.pending)
    approved_by: Mapped[str | None] = mapped_column(fk("User.id", "SET NULL"))
    approved_at: Mapped[datetime | None]
    paid_by: Mapped[str | None] = mapped_column(fk("User.id", "SET NULL"))
    paid_at: Mapped[datetime | None]
    payment_reference: Mapped[str | None]
    payment_method: Mapped[str | None]
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    partner: Mapped[Partner] = relationship()
    candidate: Mapped[Candidate] = relationship()
    case: Mapped[Case | None] = relationship()
    approver: Mapped[User | None] = relationship(foreign_keys=[approved_by])
    payer: Mapped[User | None] = relationship(foreign_keys=[paid_by])


class AdminFee(SoftDeletable, Base):
    __tablename__ = "AdminFee"
    __table_args__ = (
        Index("AdminFee_partner_id_idx", "partner_id"),
        Index("AdminFee_candidate_id_idx", "candidate_id"),
        Index("AdminFee_status_idx", "status"),
    )

    id: Mapped[str] = pk()
    partner_id: Mapped[str] = mapped_column(fk("Partner.id", "CASCADE"))
    candidate_id: Mapped[str] = mapped_column(fk("Candidate.id", "CASCADE"))
    case_id: Mapped[str | None] = mapped_column(fk("Case.id", "SET NULL"))
    fee_type: Mapped[AdminFeeType] = enum_col(AdminFeeType)
    period: Mapped[str]
    amount: Mapped[Decimal] = money()
    currency: Mapped[str] = mapped_column(default="USD", server_default="USD")
    status: Mapped[CommissionStatus] = enum_col(CommissionStatus, default=CommissionStatus.pending)
    paid_by: Mapped[str | None] = mapped_column(fk("User.id", "SET NULL"))
    paid_at: Mapped[datetime | None]
    payment_reference: Mapped[str | None]
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    partner: Mapped[Partner] = relationship()
    candidate: Mapped[Candidate] = relationship()
    case: Mapped[Case | None] = relationship()
    payer: Mapped[User | None] = relationship()


class PartnerReport(SoftDeletable, Base):
    __tablename__ = "PartnerReport"
    __table_args__ = (Index("PartnerReport_partner_id_idx", "partner_id"),)

    id: Mapped[str] = pk()
    partner_id: Mapped[str] = mapped_column(fk("Partner.id", "CASCADE"))
    reported_at: Mapped[datetime]
    period_start: Mapped[datetime | None]
    period_end: Mapped[datetime | None]
    # The report itself: notes, or sections as the team recorded them.
    content: Mapped[dict[str, Any]]
    status: Mapped[PartnerReportStatus] = enum_col(PartnerReportStatus, default=PartnerReportStatus.pending)
    submitted_by: Mapped[str | None] = mapped_column(fk("User.id", "SET NULL"))
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    partner: Mapped[Partner] = relationship()
    submitter: Mapped[User | None] = relationship()


class PartnerFollowUp(SoftDeletable, Base):
    __tablename__ = "PartnerFollowUp"
    __table_args__ = (
        Index("PartnerFollowUp_partner_id_idx", "partner_id"),
        Index("PartnerFollowUp_assigned_team_member_idx", "assigned_team_member"),
    )

    id: Mapped[str] = pk()
    partner_id: Mapped[str] = mapped_column(fk("Partner.id", "CASCADE"))
    action: Mapped[str]
    due_at: Mapped[datetime | None]
    assigned_team_member: Mapped[str | None] = mapped_column(fk("User.id", "SET NULL"))
    status: Mapped[PartnerFollowUpStatus] = enum_col(PartnerFollowUpStatus, default=PartnerFollowUpStatus.open)
    completed_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    partner: Mapped[Partner] = relationship()
    assignee: Mapped[User | None] = relationship()
