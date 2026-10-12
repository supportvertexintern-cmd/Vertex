from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Index, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, created_at_col, enum_col, fk, flag, pk, updated_at_col
from app.models.enums import Role

if TYPE_CHECKING:
    from app.models.candidate import Candidate
    from app.models.partners import Partner
    from app.models.referral import ReferralAgent


class Region(Base):
    __tablename__ = "Region"

    id: Mapped[str] = pk()
    name: Mapped[str] = mapped_column(unique=True)

    countries: Mapped[list[Country]] = relationship(back_populates="region")


class Country(Base):
    """Doubles as the "preferred programme destination" reference list —
    admin populates it with the countries Vertex actually places into,
    not a general world-country list."""

    __tablename__ = "Country"

    id: Mapped[str] = pk()
    name: Mapped[str] = mapped_column(unique=True)
    region_id: Mapped[str] = mapped_column(fk("Region.id", "RESTRICT"), index=True)

    region: Mapped[Region] = relationship(back_populates="countries")


class User(Base):
    __tablename__ = "User"
    __table_args__ = (Index("User_email_idx", "email"),)

    id: Mapped[str] = pk()
    full_name: Mapped[str]
    email: Mapped[str] = mapped_column(unique=True)
    password_hash: Mapped[str | None]
    google_id: Mapped[str | None] = mapped_column(unique=True)
    phone: Mapped[str | None]
    country: Mapped[str | None]
    role: Mapped[Role] = enum_col(Role, default=Role.candidate)
    email_verified: Mapped[bool] = flag(False)
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()
    # Bumped by a database trigger on password or role change; sessions
    # carry the version they were issued under (migration 0005, G19).
    token_version: Mapped[int] = mapped_column(default=0, server_default="0")

    # Agent-network structure (SRS FR-1.1, FR-1.3, FR-1.4). regional_recruiter
    # and country_supervisor use assigned_country_id; inhouse_supervisor uses
    # inhouse_country_assignments instead.
    supervisor_id: Mapped[str | None] = mapped_column(fk("User.id", "SET NULL"), index=True)
    assigned_country_id: Mapped[str | None] = mapped_column(
        fk("Country.id", "SET NULL"), index=True
    )

    supervisor: Mapped[User | None] = relationship(
        remote_side="User.id", back_populates="direct_reports"
    )
    direct_reports: Mapped[list[User]] = relationship(back_populates="supervisor")
    assigned_country: Mapped[Country | None] = relationship()
    inhouse_country_assignments: Mapped[list[InhouseCountryAssignment]] = relationship(
        back_populates="inhouse_supervisor", cascade="all, delete-orphan"
    )

    candidate: Mapped[Candidate | None] = relationship(
        back_populates="user", foreign_keys="Candidate.user_id"
    )
    partner: Mapped[Partner | None] = relationship(back_populates="user")
    referral_agent: Mapped[ReferralAgent | None] = relationship(
        back_populates="user", foreign_keys="ReferralAgent.user_id"
    )


class InhouseCountryAssignment(Base):
    """An In-House Supervisor's assignment to one of (potentially several)
    countries — supersedes assigned_country_id for that one role."""

    __tablename__ = "InhouseCountryAssignment"
    __table_args__ = (
        UniqueConstraint(
            "inhouse_supervisor_id", "country_id", name="InhouseCountryAssignment_unique"
        ),
        Index("InhouseCountryAssignment_supervisor_idx", "inhouse_supervisor_id"),
        Index("InhouseCountryAssignment_country_idx", "country_id"),
    )

    id: Mapped[str] = pk()
    inhouse_supervisor_id: Mapped[str] = mapped_column(
        fk("User.id", "CASCADE", name="InhouseCountryAssignment_supervisor_fkey")
    )
    country_id: Mapped[str] = mapped_column(
        fk("Country.id", "CASCADE", name="InhouseCountryAssignment_country_fkey")
    )
    created_at: Mapped[datetime] = created_at_col()

    inhouse_supervisor: Mapped[User] = relationship(back_populates="inhouse_country_assignments")
    country: Mapped[Country] = relationship()


class RefreshToken(Base):
    """A server-side refresh token (G19). Only the SHA-256 of the token is
    stored. Each refresh rotates it: the old row gets used_at and a new row
    joins the same family_id, which is the session the user sees. Owned by
    the Next.js app; FastAPI has no grants on it."""

    __tablename__ = "RefreshToken"

    id: Mapped[str] = pk()
    user_id: Mapped[str] = mapped_column(fk("User.id", "CASCADE"), index=True)
    family_id: Mapped[str] = mapped_column(index=True)
    token_hash: Mapped[str] = mapped_column(unique=True)
    token_version: Mapped[int]
    device_info: Mapped[str | None]
    created_at: Mapped[datetime] = created_at_col()
    expires_at: Mapped[datetime]
    used_at: Mapped[datetime | None]
    revoked_at: Mapped[datetime | None]
    revoke_reason: Mapped[str | None]
