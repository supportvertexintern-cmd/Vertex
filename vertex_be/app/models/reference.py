from __future__ import annotations

from datetime import datetime

from sqlalchemy import UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, created_at_col, fk, flag, pk, updated_at_col
from app.models.identity import Country


class Sector(Base):
    """Admin-managed "type of work" taxonomy (CIF §1)."""

    __tablename__ = "Sector"

    id: Mapped[str] = pk()
    name: Mapped[str] = mapped_column(unique=True)
    created_at: Mapped[datetime] = created_at_col()


class DocumentRequirementType(Base):
    """Admin-managed document taxonomy. `key` is the stable identifier stored
    on Document.type, CountryDocumentRequirement.document_type and the
    documents_available arrays; is_universal marks the cv/passport/
    passport_photo set every programme requires."""

    __tablename__ = "DocumentRequirementType"

    id: Mapped[str] = pk()
    key: Mapped[str] = mapped_column(unique=True)
    label: Mapped[str]
    is_universal: Mapped[bool] = flag(False, index=True)
    sort_order: Mapped[int] = mapped_column(default=0, server_default="0")
    created_at: Mapped[datetime] = created_at_col()


class CountryDocumentRequirement(Base):
    __tablename__ = "CountryDocumentRequirement"
    __table_args__ = (UniqueConstraint("country_id", "document_type"),)

    id: Mapped[str] = pk()
    country_id: Mapped[str] = mapped_column(fk("Country.id", "CASCADE"), index=True)
    document_type: Mapped[str] = mapped_column(fk("DocumentRequirementType.key", "CASCADE"))
    created_at: Mapped[datetime] = created_at_col()

    country: Mapped[Country] = relationship()
    requirement_type: Mapped[DocumentRequirementType] = relationship()


class SystemSetting(Base):
    __tablename__ = "SystemSetting"

    key: Mapped[str] = mapped_column(primary_key=True)
    value: Mapped[str]
    description: Mapped[str | None]
    updated_at: Mapped[datetime] = updated_at_col()


class KnowledgeArticle(Base):
    __tablename__ = "KnowledgeArticle"

    id: Mapped[str] = pk()
    title: Mapped[str]
    category: Mapped[str] = mapped_column(default="General", server_default="General")
    content: Mapped[str]
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()


class EmailTemplate(Base):
    __tablename__ = "EmailTemplate"

    event: Mapped[str] = mapped_column(primary_key=True)  # e.g. "job_applied"
    subject: Mapped[str]
    body_html: Mapped[str]
    updated_at: Mapped[datetime] = updated_at_col()
