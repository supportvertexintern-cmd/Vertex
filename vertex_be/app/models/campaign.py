from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, created_at_col, enum_col, fk, pk, updated_at_col
from app.models.enums import CampaignMetric, CampaignStatus
from app.models.identity import Country, Region, User


class Campaign(Base):
    """criteria is free-form per campaign (roles, quotas, eligibility) since
    campaigns vary by destination market (FR-3.3)."""

    __tablename__ = "Campaign"

    id: Mapped[str] = pk()
    name: Mapped[str]
    criteria: Mapped[dict[str, Any]]
    status: Mapped[CampaignStatus] = enum_col(
        CampaignStatus, default=CampaignStatus.draft, index=True
    )
    created_by: Mapped[str] = mapped_column(fk("User.id", "CASCADE"), index=True)
    start_date: Mapped[datetime]
    end_date: Mapped[datetime]
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    creator: Mapped[User] = relationship()
    targets: Mapped[list[CampaignTarget]] = relationship(
        back_populates="campaign", cascade="all, delete-orphan"
    )


class CampaignTarget(Base):
    """Scoped to exactly one country, one region, or neither (campaign-wide)
    — never more than one, so actuals always compare to one target."""

    __tablename__ = "CampaignTarget"

    id: Mapped[str] = pk()
    campaign_id: Mapped[str] = mapped_column(fk("Campaign.id", "CASCADE"), index=True)
    metric: Mapped[CampaignMetric] = enum_col(CampaignMetric)
    country_id: Mapped[str | None] = mapped_column(fk("Country.id", "SET NULL"), index=True)
    region_id: Mapped[str | None] = mapped_column(fk("Region.id", "SET NULL"), index=True)
    target_value: Mapped[float]
    created_at: Mapped[datetime] = created_at_col()

    campaign: Mapped[Campaign] = relationship(back_populates="targets")
    country: Mapped[Country | None] = relationship()
    region: Mapped[Region | None] = relationship()
    recruiter_targets: Mapped[list[RecruiterTarget]] = relationship(
        back_populates="campaign_target", cascade="all, delete-orphan"
    )


class RecruiterTarget(Base):
    """A Country Supervisor's allocation of a country CampaignTarget to one of
    their recruiters — always traceable to a real campaign goal."""

    __tablename__ = "RecruiterTarget"
    __table_args__ = (UniqueConstraint("campaign_target_id", "recruiter_id"),)

    id: Mapped[str] = pk()
    campaign_target_id: Mapped[str] = mapped_column(fk("CampaignTarget.id", "CASCADE"))
    recruiter_id: Mapped[str] = mapped_column(fk("User.id", "CASCADE"), index=True)
    target_value: Mapped[float]
    # NOT NULL with ON DELETE SET NULL, inherited as-is (see StaffKpiTarget).
    set_by: Mapped[str] = mapped_column(fk("User.id", "SET NULL"))
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    campaign_target: Mapped[CampaignTarget] = relationship(back_populates="recruiter_targets")
    recruiter: Mapped[User] = relationship(foreign_keys=[recruiter_id])
    setter: Mapped[User] = relationship(foreign_keys=[set_by])
