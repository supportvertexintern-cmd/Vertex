from __future__ import annotations

from datetime import datetime

from sqlalchemy import Text, text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, created_at_col, enum_col, fk, flag, pk, updated_at_col
from app.models.candidate import Candidate, Document
from app.models.enums import (
    ContactChannel,
    Gender,
    MouStatus,
    PartnerCandidateStatus,
    PartnerStatus,
    PartnerType,
)
from app.models.identity import Country, User
from app.models.jobs import Job, JobPosition


class Partner(Base):
    """An agency / manpower supplier that sources candidates (FR-5.1).
    country_of_operation is free text — an agency can be based anywhere."""

    __tablename__ = "Partner"

    id: Mapped[str] = pk()
    name: Mapped[str]
    partner_type: Mapped[PartnerType] = enum_col(PartnerType)
    country_of_operation: Mapped[str]
    business_registration_number: Mapped[str | None]
    contact_name: Mapped[str]
    contact_email: Mapped[str]
    contact_phone: Mapped[str]
    status: Mapped[PartnerStatus] = enum_col(PartnerStatus, default=PartnerStatus.pending, index=True)
    mou_status: Mapped[MouStatus] = enum_col(MouStatus, default=MouStatus.none)
    mou_signed_at: Mapped[datetime | None]
    notes: Mapped[str | None]
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()
    # The partner's own login, null until admin provisions one.
    user_id: Mapped[str | None] = mapped_column(fk("User.id", "SET NULL"), unique=True)

    user: Mapped[User | None] = relationship(back_populates="partner")
    partner_candidates: Mapped[list[PartnerCandidate]] = relationship(
        back_populates="partner", cascade="all, delete-orphan"
    )


class PartnerCandidate(Base):
    """A candidate submitted through a partner's own portal — a separate
    funnel from Candidate/Application. Starts as a "draft" (every form field
    nullable) and is validated in full only when submitted; HR review then
    bridges it into a real Candidate (bridged_candidate_id)."""

    __tablename__ = "PartnerCandidate"

    id: Mapped[str] = pk()
    partner_id: Mapped[str] = mapped_column(fk("Partner.id", "CASCADE"), index=True)
    status: Mapped[PartnerCandidateStatus] = enum_col(
        PartnerCandidateStatus, default=PartnerCandidateStatus.submitted, index=True
    )

    # §3 Personal Information
    full_name: Mapped[str | None]
    date_of_birth: Mapped[datetime | None]
    nationality: Mapped[str | None]
    second_nationality: Mapped[str | None]
    gender: Mapped[Gender | None] = enum_col(Gender)
    passport_number: Mapped[str | None] = mapped_column(index=True)
    passport_expiry: Mapped[datetime | None]
    current_occupation: Mapped[str | None]
    highest_education: Mapped[str | None]
    home_address: Mapped[str | None]
    # No longer collected (partners keep direct contact details private);
    # kept for older submissions.
    phone: Mapped[str | None]
    whatsapp_number: Mapped[str | None]
    email: Mapped[str | None]
    marital_status: Mapped[str | None]

    # §2 Programme Selection — one specific opportunity.
    job_id: Mapped[str | None] = mapped_column(fk("Job.id", "RESTRICT"), index=True)
    job_position_id: Mapped[str | None] = mapped_column(fk("JobPosition.id", "SET NULL"), index=True)
    earliest_travel_date: Mapped[datetime | None]
    prior_eu_visa_applied: Mapped[bool | None]
    prior_eu_visa_applied_details: Mapped[str | None]

    # §4 Document Checklist
    documents_available: Mapped[list[str]] = mapped_column(
        ARRAY(Text), default=list, server_default=text("'{}'::text[]")
    )
    # §5 Payment Plan Acknowledgement
    payment_plan_acknowledged: Mapped[bool] = flag(False)

    # §6 Visa & Travel Readiness
    current_location_country_name: Mapped[str | None]
    current_location_country_id: Mapped[str | None] = mapped_column(fk("Country.id", "SET NULL"))
    holds_schengen_visa: Mapped[bool | None]
    holds_schengen_visa_details: Mapped[str | None]
    prior_visa_refusals: Mapped[bool | None]
    prior_visa_refusals_details: Mapped[str | None]
    available_for_embassy_appointment: Mapped[bool] = flag(False)
    willing_to_start_within_30_days: Mapped[bool] = flag(False)
    preferred_contact_channel: Mapped[ContactChannel | None] = enum_col(ContactChannel)

    # Vertex-side review
    reviewed_by: Mapped[str | None] = mapped_column(fk("User.id", "SET NULL"))
    rejection_reason: Mapped[str | None]
    bridged_candidate_id: Mapped[str | None] = mapped_column(
        fk("Candidate.id", "SET NULL"), unique=True
    )

    submitted_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    partner: Mapped[Partner] = relationship(back_populates="partner_candidates")
    job: Mapped[Job | None] = relationship()
    job_position: Mapped[JobPosition | None] = relationship()
    current_location_country: Mapped[Country | None] = relationship()
    reviewer: Mapped[User | None] = relationship()
    bridged_candidate: Mapped[Candidate | None] = relationship(
        back_populates="partner_candidate_origin"
    )
    documents: Mapped[list[Document]] = relationship(back_populates="partner_candidate")
