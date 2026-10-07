from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Index, Text, text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, created_at_col, enum_col, fk, flag, pk, updated_at_col
from app.models.enums import (
    ApplicationStatus,
    CandidateLifecycleStatus,
    CandidateSource,
    ContactChannel,
    Gender,
    VerificationStatus,
)
from app.models.identity import Country, User
from app.models.reference import DocumentRequirementType, Sector

if TYPE_CHECKING:
    from app.models.cases import Case
    from app.models.jobs import Job, JobPosition
    from app.models.partners import Partner, PartnerCandidate
    from app.models.referral import ReferralAgent


def _text_array():
    return mapped_column(ARRAY(Text), default=list, server_default=text("'{}'::text[]"))


class Candidate(Base):
    __tablename__ = "Candidate"
    __table_args__ = (
        Index("Candidate_user_id_idx", "user_id"),
        Index("Candidate_recruiter_id_lifecycle_status_idx", "recruiter_id", "lifecycle_status"),
        Index("Candidate_country_id_lifecycle_status_idx", "country_id", "lifecycle_status"),
    )

    id: Mapped[str] = pk()
    # Nullable: a recruiter-sourced lead may not have an account yet (FR-2.1).
    user_id: Mapped[str | None] = mapped_column(fk("User.id", "CASCADE"), unique=True)
    passport_number: Mapped[str | None]
    passport_expiry: Mapped[datetime | None]
    date_of_birth: Mapped[datetime | None]
    nationality: Mapped[str | None]
    second_nationality: Mapped[str | None]
    gender: Mapped[Gender | None] = enum_col(Gender)
    current_occupation: Mapped[str | None]
    highest_education: Mapped[str | None]
    home_address: Mapped[str | None]
    whatsapp_number: Mapped[str | None]
    marital_status: Mapped[str | None]
    created_at: Mapped[datetime] = created_at_col(index=True)
    updated_at: Mapped[datetime] = updated_at_col()

    # Pre-registration identity — only meaningful while user_id is null; once
    # a User is linked, its full_name/phone/email are authoritative.
    full_name: Mapped[str | None]
    phone: Mapped[str | None]
    email: Mapped[str | None]
    desired_role: Mapped[str | None]

    source: Mapped[CandidateSource] = enum_col(
        CandidateSource, default=CandidateSource.self_registered
    )
    recruiter_id: Mapped[str | None] = mapped_column(fk("User.id", "SET NULL"), index=True)
    # Always the picked world-country name; country_id only resolves when it
    # matches an admin-managed Country row.
    country_name: Mapped[str | None]
    country_id: Mapped[str | None] = mapped_column(fk("Country.id", "SET NULL"), index=True)
    lifecycle_status: Mapped[CandidateLifecycleStatus] = enum_col(
        CandidateLifecycleStatus, default=CandidateLifecycleStatus.identified, index=True
    )
    partner_id: Mapped[str | None] = mapped_column(fk("Partner.id", "SET NULL"), index=True)
    referral_agent_id: Mapped[str | None] = mapped_column(
        fk("ReferralAgent.id", "SET NULL"), index=True
    )
    # Flagged, never auto-blocked, when a referral-sourced candidate matches
    # an existing one by email/phone/passport at creation time.
    referral_duplicate_flag: Mapped[bool] = flag(False)

    # Screening gate (FR-2.5) + verification-return workflow (FR-2.7).
    consent_given: Mapped[bool] = flag(False)
    consent_at: Mapped[datetime | None]
    return_reason: Mapped[str | None]
    # Persisted gate outcome; null until evaluated at least once.
    screening_result: Mapped[bool | None]
    screening_evaluated_at: Mapped[datetime | None]

    user: Mapped[User | None] = relationship(back_populates="candidate", foreign_keys=[user_id])
    recruiter: Mapped[User | None] = relationship(foreign_keys=[recruiter_id])
    country: Mapped[Country | None] = relationship()
    partner: Mapped[Partner | None] = relationship()
    referral_agent: Mapped[ReferralAgent | None] = relationship()

    applications: Mapped[list[Application]] = relationship(
        back_populates="candidate", cascade="all, delete-orphan"
    )
    documents: Mapped[list[Document]] = relationship(
        back_populates="candidate", cascade="all, delete-orphan"
    )
    messages: Mapped[list[CandidateMessage]] = relationship(
        back_populates="candidate", cascade="all, delete-orphan", order_by="CandidateMessage.created_at"
    )
    partner_candidate_origin: Mapped[PartnerCandidate | None] = relationship(
        back_populates="bridged_candidate"
    )


class Document(Base):
    """Exactly one of candidate_id / partner_candidate_id is set (enforced in
    the upload service): a partner draft's documents are filed under the
    PartnerCandidate and reparented once it's finalized."""

    __tablename__ = "Document"

    id: Mapped[str] = pk()
    candidate_id: Mapped[str | None] = mapped_column(fk("Candidate.id", "CASCADE"), index=True)
    partner_candidate_id: Mapped[str | None] = mapped_column(
        fk("PartnerCandidate.id", "CASCADE"), index=True
    )
    type: Mapped[str] = mapped_column(fk("DocumentRequirementType.key", "RESTRICT"), index=True)
    storage_path: Mapped[str]  # private-storage relative path, never a public URL
    verification_status: Mapped[VerificationStatus] = enum_col(
        VerificationStatus, default=VerificationStatus.pending
    )
    verified_by: Mapped[str | None]  # user id, intentionally not a FK
    verified_at: Mapped[datetime | None]
    uploaded_at: Mapped[datetime] = created_at_col()
    # Free-text name for type "other", the one type that may repeat per candidate.
    label: Mapped[str | None]

    candidate: Mapped[Candidate | None] = relationship(back_populates="documents")
    partner_candidate: Mapped[PartnerCandidate | None] = relationship(back_populates="documents")
    requirement_type: Mapped[DocumentRequirementType] = relationship()


class CandidateMessage(Base):
    """One continuous thread per candidate, between the candidate's own User
    and their assigned recruiter."""

    __tablename__ = "CandidateMessage"

    id: Mapped[str] = pk()
    candidate_id: Mapped[str] = mapped_column(fk("Candidate.id", "CASCADE"), index=True)
    sender_id: Mapped[str] = mapped_column(fk("User.id", "CASCADE"))
    body: Mapped[str]
    created_at: Mapped[datetime] = created_at_col()
    # updated_at != created_at is the "(edited)" marker.
    updated_at: Mapped[datetime] = updated_at_col()

    candidate: Mapped[Candidate] = relationship(back_populates="messages")
    sender: Mapped[User] = relationship()


class Application(Base):
    """A Candidate Information Form submission."""

    __tablename__ = "Application"

    id: Mapped[str] = pk()
    candidate_id: Mapped[str] = mapped_column(fk("Candidate.id", "CASCADE"), index=True)
    job_id: Mapped[str | None] = mapped_column(fk("Job.id", "CASCADE"), index=True)
    application_status: Mapped[ApplicationStatus] = enum_col(
        ApplicationStatus, default=ApplicationStatus.submitted, index=True
    )
    cover_letter: Mapped[str | None]
    internal_notes: Mapped[str | None]
    interview_date: Mapped[datetime | None]
    submitted_at: Mapped[datetime] = created_at_col(index=True)
    updated_at: Mapped[datetime] = updated_at_col()

    # §1 Programme Selection — up to 3 alternatives.
    preferred_country_1_id: Mapped[str | None] = mapped_column(
        fk("Country.id", "SET NULL", name="Application_pc1_fkey")
    )
    preferred_country_2_id: Mapped[str | None] = mapped_column(
        fk("Country.id", "SET NULL", name="Application_pc2_fkey")
    )
    preferred_country_3_id: Mapped[str | None] = mapped_column(
        fk("Country.id", "SET NULL", name="Application_pc3_fkey")
    )
    preferred_sector_id: Mapped[str | None] = mapped_column(
        fk("Sector.id", "SET NULL", name="Application_sector_fkey")
    )
    earliest_travel_date: Mapped[datetime | None]
    prior_eu_visa_applied: Mapped[bool | None]
    prior_eu_visa_applied_details: Mapped[str | None]

    # §3 Document Checklist — self-reported DocumentRequirementType keys.
    documents_available: Mapped[list[str]] = _text_array()

    # §5 Visa & Travel Readiness.
    current_location_country_name: Mapped[str | None]
    current_location_country_id: Mapped[str | None] = mapped_column(
        fk("Country.id", "SET NULL", name="Application_clc_fkey"), index=True
    )
    holds_schengen_visa: Mapped[bool | None]
    holds_schengen_visa_details: Mapped[str | None]
    prior_visa_refusals: Mapped[bool | None]
    prior_visa_refusals_details: Mapped[str | None]
    available_for_embassy_appointment: Mapped[bool] = flag(False)
    willing_to_start_within_30_days: Mapped[bool] = flag(False)
    preferred_contact_channel: Mapped[ContactChannel | None] = enum_col(ContactChannel)

    # §4 Payment Plan Acknowledgement.
    payment_plan_acknowledged: Mapped[bool] = flag(False)

    job_position_id: Mapped[str | None] = mapped_column(
        fk("JobPosition.id", "SET NULL", name="Application_job_position_fkey"), index=True
    )

    candidate: Mapped[Candidate] = relationship(back_populates="applications")
    job: Mapped[Job | None] = relationship()
    job_position: Mapped[JobPosition | None] = relationship()
    preferred_country_1: Mapped[Country | None] = relationship(foreign_keys=[preferred_country_1_id])
    preferred_country_2: Mapped[Country | None] = relationship(foreign_keys=[preferred_country_2_id])
    preferred_country_3: Mapped[Country | None] = relationship(foreign_keys=[preferred_country_3_id])
    preferred_sector: Mapped[Sector | None] = relationship()
    current_location_country: Mapped[Country | None] = relationship(
        foreign_keys=[current_location_country_id]
    )
    case: Mapped[Case | None] = relationship(back_populates="application")
