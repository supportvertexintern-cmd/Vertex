from __future__ import annotations

from datetime import datetime

from sqlalchemy import Index, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, created_at_col, enum_col, fk, flag, pk, updated_at_col
from app.models.candidate import Candidate
from app.models.cases import Case
from app.models.enums import ReferralAgentStatus, ReferralCommissionStatus, ReferralMilestone
from app.models.identity import Country, User


class ReferralAgent(Base):
    """External referrer: publicly self-registers, approved by director/
    admin, then earns milestone commissions on candidates who sign up with
    their referral_code."""

    __tablename__ = "ReferralAgent"
    __table_args__ = (Index("ReferralAgent_referral_code_idx", "referral_code"),)

    id: Mapped[str] = pk()
    full_name: Mapped[str]
    email: Mapped[str] = mapped_column(unique=True)
    phone: Mapped[str]
    whatsapp_number: Mapped[str | None]
    country: Mapped[str]
    country_id: Mapped[str | None] = mapped_column(fk("Country.id", "SET NULL"), index=True)
    city: Mapped[str | None]
    date_of_birth: Mapped[datetime | None]
    nationality: Mapped[str | None]
    preferred_contact_channel: Mapped[str | None]
    previous_experience: Mapped[str | None]
    current_occupation: Mapped[str | None]
    network_size: Mapped[int | None]
    social_media_profiles: Mapped[str | None]
    promotion_plan: Mapped[str | None]
    payment_details: Mapped[str | None]
    status: Mapped[ReferralAgentStatus] = enum_col(
        ReferralAgentStatus, default=ReferralAgentStatus.pending_approval, index=True
    )
    referral_code: Mapped[str] = mapped_column(unique=True)
    email_verified: Mapped[bool] = flag(False)
    approved_by_id: Mapped[str | None] = mapped_column(fk("User.id", "SET NULL"))
    approved_at: Mapped[datetime | None]
    rejection_reason: Mapped[str | None]
    suspended_reason: Mapped[str | None]
    user_id: Mapped[str | None] = mapped_column(fk("User.id", "SET NULL"), unique=True)
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    country_ref: Mapped[Country | None] = relationship()
    approved_by: Mapped[User | None] = relationship(foreign_keys=[approved_by_id])
    user: Mapped[User | None] = relationship(back_populates="referral_agent", foreign_keys=[user_id])
    commissions: Mapped[list[ReferralCommission]] = relationship(back_populates="referral_agent")
    targets: Mapped[list[ReferralAgentTarget]] = relationship(
        back_populates="referral_agent", cascade="all, delete-orphan"
    )


class ReferralCommissionRule(Base):
    """Per-country commission amount for each milestone."""

    __tablename__ = "ReferralCommissionRule"
    __table_args__ = (UniqueConstraint("country_id", "milestone"),)

    id: Mapped[str] = pk()
    country_id: Mapped[str] = mapped_column(fk("Country.id", "CASCADE"), index=True)
    milestone: Mapped[ReferralMilestone] = enum_col(ReferralMilestone)
    amount: Mapped[float] = mapped_column(default=0, server_default=text("0"))
    currency: Mapped[str] = mapped_column(default="USD", server_default="USD")
    updated_by: Mapped[str] = mapped_column(fk("User.id", "CASCADE"))
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    country: Mapped[Country] = relationship()
    updater: Mapped[User] = relationship()


class ReferralCommission(Base):
    """At most one commission per candidate per milestone."""

    __tablename__ = "ReferralCommission"
    __table_args__ = (
        UniqueConstraint("candidate_id", "milestone"),
        Index("ReferralCommission_agent_id_idx", "referral_agent_id"),
    )

    id: Mapped[str] = pk()
    referral_agent_id: Mapped[str] = mapped_column(
        fk("ReferralAgent.id", "CASCADE", name="ReferralCommission_agent_fkey")
    )
    candidate_id: Mapped[str] = mapped_column(
        fk("Candidate.id", "CASCADE", name="ReferralCommission_candidate_fkey")
    )
    case_id: Mapped[str | None] = mapped_column(
        fk("Case.id", "SET NULL", name="ReferralCommission_case_fkey")
    )
    milestone: Mapped[ReferralMilestone] = enum_col(ReferralMilestone)
    commission_rule_id: Mapped[str | None] = mapped_column(
        fk("ReferralCommissionRule.id", "SET NULL", name="ReferralCommission_rule_fkey")
    )
    amount: Mapped[float]
    currency: Mapped[str] = mapped_column(default="USD", server_default="USD")
    status: Mapped[ReferralCommissionStatus] = enum_col(
        ReferralCommissionStatus, default=ReferralCommissionStatus.pending, index=True
    )
    approved_by_id: Mapped[str | None] = mapped_column(
        fk("User.id", "SET NULL", name="ReferralCommission_approved_by_fkey")
    )
    approved_at: Mapped[datetime | None]
    paid_by_id: Mapped[str | None] = mapped_column(
        fk("User.id", "SET NULL", name="ReferralCommission_paid_by_fkey")
    )
    paid_at: Mapped[datetime | None]
    payment_reference: Mapped[str | None]
    payment_method: Mapped[str | None]
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    referral_agent: Mapped[ReferralAgent] = relationship(back_populates="commissions")
    candidate: Mapped[Candidate] = relationship()
    case: Mapped[Case | None] = relationship()
    commission_rule: Mapped[ReferralCommissionRule | None] = relationship()
    approved_by: Mapped[User | None] = relationship(foreign_keys=[approved_by_id])
    paid_by: Mapped[User | None] = relationship(foreign_keys=[paid_by_id])


class ReferralAgentTarget(Base):
    __tablename__ = "ReferralAgentTarget"
    __table_args__ = (Index("ReferralAgentTarget_agent_id_idx", "referral_agent_id"),)

    id: Mapped[str] = pk()
    referral_agent_id: Mapped[str] = mapped_column(
        fk("ReferralAgent.id", "CASCADE", name="ReferralAgentTarget_agent_fkey")
    )
    period_start: Mapped[datetime]
    period_end: Mapped[datetime]
    target_referrals: Mapped[int]
    set_by: Mapped[str] = mapped_column(fk("User.id", "CASCADE"))
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    referral_agent: Mapped[ReferralAgent] = relationship(back_populates="targets")
    setter: Mapped[User] = relationship()
