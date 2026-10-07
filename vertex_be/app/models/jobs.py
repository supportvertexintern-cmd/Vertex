from __future__ import annotations

from datetime import datetime

from sqlalchemy import UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, created_at_col, enum_col, fk, flag, pk, updated_at_col
from app.models.enums import CaseStage, EmployerClientStatus, JobStatus


class EmployerClient(Base):
    """The employer a vacancy is for (FR-5.2) — distinct from Partner, which
    sources candidates, not jobs."""

    __tablename__ = "EmployerClient"

    id: Mapped[str] = pk()
    name: Mapped[str]
    country: Mapped[str]
    industry: Mapped[str | None]
    contact_name: Mapped[str]
    contact_email: Mapped[str]
    contact_phone: Mapped[str]
    status: Mapped[EmployerClientStatus] = enum_col(
        EmployerClientStatus, default=EmployerClientStatus.active, index=True
    )
    notes: Mapped[str | None]
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    jobs: Mapped[list[Job]] = relationship(back_populates="employer_client")


class Job(Base):
    """A work-permit programme/opportunity. Its fee schedule is entirely its
    own payment_stages — no fixed installment shape is assumed."""

    __tablename__ = "Job"

    id: Mapped[str] = pk()
    title: Mapped[str]
    country: Mapped[str] = mapped_column(index=True)
    city: Mapped[str]
    category: Mapped[str | None]
    salary_range: Mapped[str | None]
    job_description: Mapped[str]
    requirements: Mapped[str]
    status: Mapped[JobStatus] = enum_col(JobStatus, default=JobStatus.active, index=True)
    application_fee: Mapped[float | None] = mapped_column(default=0, server_default=text("0"))
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    # Service & Pricing List.
    visa_type: Mapped[str | None]
    duration_permit: Mapped[str | None]
    processing_time: Mapped[str | None]
    service_fee_gbp: Mapped[float | None]
    visa_success_rates: Mapped[str | None]
    tier: Mapped[str | None]  # Premium/Skilled/Standard/Entry — display only

    # Display/grouping flag only; drives no payment math.
    is_credit_service: Mapped[bool] = flag(False)
    # Visible only to partners (and staff submitting on a partner's behalf).
    partner_only: Mapped[bool] = flag(False, index=True)

    employer_client_id: Mapped[str | None] = mapped_column(
        fk("EmployerClient.id", "SET NULL"), index=True
    )

    employer_client: Mapped[EmployerClient | None] = relationship(back_populates="jobs")
    sectors: Mapped[list[JobSector]] = relationship(
        back_populates="job", cascade="all, delete-orphan"
    )
    payment_stages: Mapped[list[JobPaymentStage]] = relationship(
        back_populates="job", cascade="all, delete-orphan", order_by="JobPaymentStage.order"
    )


class JobSector(Base):
    """One of the 8 canonical sector names attached to a programme."""

    __tablename__ = "JobSector"
    __table_args__ = (UniqueConstraint("job_id", "sector"),)

    id: Mapped[str] = pk()
    job_id: Mapped[str] = mapped_column(fk("Job.id", "CASCADE"), index=True)
    sector: Mapped[str]
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    job: Mapped[Job] = relationship(back_populates="sectors")
    positions: Mapped[list[JobPosition]] = relationship(
        back_populates="job_sector", cascade="all, delete-orphan"
    )


class JobPosition(Base):
    """Leaf-level pick on both application forms; city falls back to the
    parent Job's city when unset."""

    __tablename__ = "JobPosition"

    id: Mapped[str] = pk()
    job_sector_id: Mapped[str] = mapped_column(fk("JobSector.id", "CASCADE"), index=True)
    title: Mapped[str]
    city: Mapped[str | None]
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    job_sector: Mapped[JobSector] = relationship(back_populates="positions")


class JobPaymentStage(Base):
    """One installment of a Job's fee: a percent of service_fee_gbp due once
    a Case reaches trigger_stage. Several may share a trigger_stage; `order`
    sequences them. synced_amount_gbp is the amount stripe_price_id was
    created for (Stripe Prices are immutable)."""

    __tablename__ = "JobPaymentStage"
    __table_args__ = (UniqueConstraint("job_id", "order"),)

    id: Mapped[str] = pk()
    job_id: Mapped[str] = mapped_column(fk("Job.id", "CASCADE"), index=True)
    order: Mapped[int]
    label: Mapped[str]
    percent: Mapped[float]
    trigger_stage: Mapped[CaseStage] = enum_col(CaseStage, index=True)
    stripe_product_id: Mapped[str | None]
    stripe_price_id: Mapped[str | None]
    synced_amount_gbp: Mapped[float | None]
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    job: Mapped[Job] = relationship(back_populates="payment_stages")
