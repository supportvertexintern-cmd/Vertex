"""the landing pages' content: marketing's drafts, publishes and revisions (2026-11-21)

Two tables (app/models/content.py). Nothing is seeded: a block with no row
shows the built-in text in app/services/landing_content.py, the same text
the pages had before, so the site looks the same until marketing publishes.

Revision ID: 0026
Revises: 0025
Create Date: 2026-11-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0026"
down_revision: str | None = "0025"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def ts(name: str, nullable: bool = True) -> sa.Column:
    return sa.Column(name, postgresql.TIMESTAMP(precision=3), nullable=nullable)


def now(name: str) -> sa.Column:
    return sa.Column(name, postgresql.TIMESTAMP(precision=3), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False)


def soft_delete() -> list[sa.Column]:
    return [ts("deleted_at"), sa.Column("deleted_links", postgresql.JSONB(), nullable=True)]


def user_fk(table: str, column: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint([column], ["User.id"], name=f"{table}_{column}_fkey", onupdate="CASCADE", ondelete="SET NULL")


def upgrade() -> None:
    op.create_table(
        "ContentBlock",
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("draft_body", postgresql.JSONB(), nullable=True),
        sa.Column("draft_visible", sa.Boolean(), nullable=True),
        ts("draft_updated_at"),
        sa.Column("draft_updated_by", sa.Text(), nullable=True),
        sa.Column("published_body", postgresql.JSONB(), nullable=True),
        sa.Column("published_visible", sa.Boolean(), server_default=sa.true(), nullable=False),
        ts("published_at"),
        sa.Column("published_by", sa.Text(), nullable=True),
        sa.Column("revision", sa.Integer(), server_default="0", nullable=False),
        now("created_at"),
        now("updated_at"),
        *soft_delete(),
        sa.PrimaryKeyConstraint("key", name="ContentBlock_pkey"),
        user_fk("ContentBlock", "draft_updated_by"),
        user_fk("ContentBlock", "published_by"),
    )
    op.create_table(
        "ContentRevision",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("block_key", sa.Text(), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("body", postgresql.JSONB(), nullable=False),
        sa.Column("visible", sa.Boolean(), nullable=False),
        sa.Column("published_by", sa.Text(), nullable=True),
        now("published_at"),
        *soft_delete(),
        sa.PrimaryKeyConstraint("id", name="ContentRevision_pkey"),
        sa.ForeignKeyConstraint(
            ["block_key"], ["ContentBlock.key"], name="ContentRevision_block_key_fkey", onupdate="CASCADE", ondelete="CASCADE"
        ),
        user_fk("ContentRevision", "published_by"),
        sa.UniqueConstraint("block_key", "number", name="ContentRevision_block_key_number_key"),
    )


def downgrade() -> None:
    op.drop_table("ContentRevision")
    op.drop_table("ContentBlock")
