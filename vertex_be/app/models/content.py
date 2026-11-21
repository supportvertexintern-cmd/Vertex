"""The landing pages' content (the landing CMS, 2026-11-21).

Marketing edits the website's home page and the mobile app's home screen
without a release. The sections are fixed in code (app/services/
landing_content.py names each block and the shape of its body); a row here
holds what marketing changed:

- ContentBlock: one row per block key that has ever been edited. A draft
  (body and visibility) is what marketing is working on; the published
  body and visibility are what visitors see. A block with no row, or no
  published body, shows the built-in text (the same text the pages had
  before the CMS), so the site looks the same until something is published.
- ContentRevision: one row per publish, numbered per block, so any earlier
  version can be restored into the draft and published again.

Bodies are JSON, validated against the block's shape before they are
stored: plain text and checked links only, never HTML.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, SoftDeletable, created_at_col, flag, fk, pk, updated_at_col


class ContentBlock(SoftDeletable, Base):
    __tablename__ = "ContentBlock"

    key: Mapped[str] = mapped_column(primary_key=True)  # e.g. "web.hero", "shared.contact"
    draft_body: Mapped[dict[str, Any] | None]
    draft_visible: Mapped[bool | None]
    draft_updated_at: Mapped[datetime | None]
    draft_updated_by: Mapped[str | None] = mapped_column(fk("User.id", "SET NULL"))
    published_body: Mapped[dict[str, Any] | None]
    published_visible: Mapped[bool] = flag(True)
    published_at: Mapped[datetime | None]
    published_by: Mapped[str | None] = mapped_column(fk("User.id", "SET NULL"))
    revision: Mapped[int] = mapped_column(default=0, server_default="0")  # the latest ContentRevision.number
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()


class ContentRevision(SoftDeletable, Base):
    __tablename__ = "ContentRevision"
    __table_args__ = (UniqueConstraint("block_key", "number"),)

    id: Mapped[str] = pk()
    block_key: Mapped[str] = mapped_column(fk("ContentBlock.key", "CASCADE"))
    number: Mapped[int]
    body: Mapped[dict[str, Any]]
    visible: Mapped[bool]
    published_by: Mapped[str | None] = mapped_column(fk("User.id", "SET NULL"))
    published_at: Mapped[datetime] = created_at_col()
