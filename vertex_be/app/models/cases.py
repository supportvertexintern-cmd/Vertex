from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, created_at_col, enum_col, fk, flag, pk, updated_at_col
from app.models.candidate import Application, Document
from app.models.enums import (
    CaseOpsReviewStatus,
    CasePaymentStatus,
    CaseReminderChannel,
    CaseStage,
    CaseStatus,
    ContractStatus,
    MilestonePaymentType,
)
from app.models.identity import Country, User
from app.models.jobs import JobPaymentStage


class Case(Base):
    """The post-approval mobility lifecycle for one Application.

    ops_review_* is Operations' second look at the paperwork and gates stage
    advancement; status/rejected_* is a real terminal close of the case."""

    __tablename__ = "Case"

    id: Mapped[str] = pk()
    application_id: Mapped[str] = mapped_column(fk("Application.id", "CASCADE"), unique=True)
    current_stage: Mapped[CaseStage] = enum_col(
        CaseStage, default=CaseStage.registration_document_submission, index=True
    )
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()
    stage_deadline: Mapped[datetime | None]

    ops_review_status: Mapped[CaseOpsReviewStatus] = enum_col(
        CaseOpsReviewStatus, default=CaseOpsReviewStatus.pending, index=True
    )
    ops_reviewed_by_id: Mapped[str | None] = mapped_column(fk("User.id", "SET NULL"))
    ops_reviewed_at: Mapped[datetime | None]
    ops_review_notes: Mapped[str | None]

    status: Mapped[CaseStatus] = enum_col(CaseStatus, default=CaseStatus.active, index=True)
    rejected_at: Mapped[datetime | None]
    rejected_by_id: Mapped[str | None] = mapped_column(fk("User.id", "SET NULL"))
    rejection_reason: Mapped[str | None]

    application: Mapped[Application] = relationship(back_populates="case")
    ops_reviewed_by: Mapped[User | None] = relationship(foreign_keys=[ops_reviewed_by_id])
    rejected_by: Mapped[User | None] = relationship(foreign_keys=[rejected_by_id])

    stage_events: Mapped[list[CaseStageEvent]] = relationship(
        back_populates="case", cascade="all, delete-orphan", order_by="CaseStageEvent.entered_at"
    )
    payments: Mapped[list[CasePayment]] = relationship(
        back_populates="case", cascade="all, delete-orphan"
    )
    reminders: Mapped[list[CaseReminder]] = relationship(
        back_populates="case", cascade="all, delete-orphan"
    )
    contract: Mapped[Contract | None] = relationship(
        back_populates="case", cascade="all, delete-orphan"
    )
    retention_follow_up: Mapped[RetentionFollowUp | None] = relationship(
        back_populates="case", cascade="all, delete-orphan"
    )


class CaseStageEvent(Base):
    __tablename__ = "CaseStageEvent"

    id: Mapped[str] = pk()
    case_id: Mapped[str] = mapped_column(fk("Case.id", "CASCADE"), index=True)
    stage: Mapped[CaseStage] = enum_col(CaseStage, index=True)
    owner_id: Mapped[str | None] = mapped_column(fk("User.id", "SET NULL"))
    # Staff-entered effective date (may be backdated); defaults to now.
    entered_at: Mapped[datetime] = created_at_col()
    completed_at: Mapped[datetime | None]
    notes: Mapped[str | None]

    case: Mapped[Case] = relationship(back_populates="stage_events")
    owner: Mapped[User | None] = relationship()


class CaseReminder(Base):
    """Manual, staff-triggered nudge. The row itself is the audit record."""

    __tablename__ = "CaseReminder"

    id: Mapped[str] = pk()
    case_id: Mapped[str] = mapped_column(fk("Case.id", "CASCADE"), index=True)
    channel: Mapped[CaseReminderChannel] = enum_col(CaseReminderChannel)
    recipient: Mapped[str]
    message: Mapped[str | None]
    sent_by: Mapped[str] = mapped_column(fk("User.id", "CASCADE"))
    sent_at: Mapped[datetime] = created_at_col()

    case: Mapped[Case] = relationship(back_populates="reminders")
    sender: Mapped[User] = relationship()


class RetentionFollowUp(Base):
    __tablename__ = "RetentionFollowUp"

    id: Mapped[str] = pk()
    case_id: Mapped[str] = mapped_column(fk("Case.id", "CASCADE"), unique=True)
    due_at: Mapped[datetime]  # +90 days from departure/arrival completion
    completed_at: Mapped[datetime | None]
    notes: Mapped[str | None]

    case: Mapped[Case] = relationship(back_populates="retention_follow_up")


class CasePayment(Base):
    """One collected (or Stripe-link-pending) installment against a Job
    payment stage. Manually recorded rows default to "collected"; a
    generated Stripe Payment Link row starts "pending" until the webhook."""

    __tablename__ = "CasePayment"

    id: Mapped[str] = pk()
    case_id: Mapped[str] = mapped_column(fk("Case.id", "CASCADE"), index=True)
    job_payment_stage_id: Mapped[str] = mapped_column(fk("JobPaymentStage.id", "RESTRICT"))
    # Unused since 0006 (payments are per stage again); kept, nothing dropped.
    type: Mapped[MilestonePaymentType | None] = enum_col(MilestonePaymentType)
    amount: Mapped[float]
    currency: Mapped[str] = mapped_column(default="USD", server_default="USD")
    receipt_reference: Mapped[str | None]
    receipt_document_id: Mapped[str | None] = mapped_column(fk("Document.id", "SET NULL"))
    recorded_by: Mapped[str] = mapped_column(fk("User.id", "CASCADE"))
    recorded_at: Mapped[datetime] = created_at_col()
    status: Mapped[CasePaymentStatus] = enum_col(
        CasePaymentStatus, default=CasePaymentStatus.collected
    )
    stripe_payment_link_id: Mapped[str | None]
    stripe_payment_link_url: Mapped[str | None]
    stripe_checkout_session_id: Mapped[str | None]
    sent_to_email: Mapped[str | None]

    case: Mapped[Case] = relationship(back_populates="payments")
    job_payment_stage: Mapped[JobPaymentStage] = relationship()
    receipt_document: Mapped[Document | None] = relationship()
    recorder: Mapped[User] = relationship()


class Contract(Base):
    """Generated contract + simple electronic signature (typed name +
    authenticated session + timestamp + IP)."""

    __tablename__ = "Contract"

    id: Mapped[str] = pk()
    case_id: Mapped[str] = mapped_column(fk("Case.id", "CASCADE"), unique=True)
    content: Mapped[str]
    status: Mapped[ContractStatus] = enum_col(ContractStatus, default=ContractStatus.draft)
    signed_by_name: Mapped[str | None]
    signed_at: Mapped[datetime | None]
    signed_ip: Mapped[str | None]
    created_by: Mapped[str] = mapped_column(fk("User.id", "CASCADE"))
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    case: Mapped[Case] = relationship(back_populates="contract")
    creator: Mapped[User] = relationship()


class FeePolicy(Base):
    """Admin-configurable milestone-payment policy (FR-4.5). country_id null
    is the global default; a country row overrides it."""

    __tablename__ = "FeePolicy"

    id: Mapped[str] = pk()
    country_id: Mapped[str | None] = mapped_column(fk("Country.id", "SET NULL"), index=True)
    enabled: Mapped[bool] = flag(False)
    documentation_amount: Mapped[float | None]
    permit_amount: Mapped[float | None]
    visa_amount: Mapped[float | None]
    currency: Mapped[str] = mapped_column(default="USD", server_default="USD")
    updated_by: Mapped[str] = mapped_column(fk("User.id", "CASCADE"))
    updated_at: Mapped[datetime] = updated_at_col()

    country: Mapped[Country | None] = relationship()
    updater: Mapped[User] = relationship()
