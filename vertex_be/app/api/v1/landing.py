"""The landing pages' content (the landing CMS, 2026-11-21).

One read for the pages, and marketing's editor:

- GET /content/landing?app=web|mobile: the blocks an app shows, published
  or built-in, for anyone the website calls for (WebsiteOrUser; the website
  rate-limits anonymous visitors, and the mobile app's home screen reads
  through it before sign-in). preview=true shows the drafts instead, for
  the roles that edit or publish them.
- /content/blocks...: a block's draft is saved, discarded, and restored
  from an earlier revision with the landing.edit permission, and published
  with landing.publish; either one reads the blocks.

The admin assigns both to roles (app/core/permissions.py; role management,
2026-11-21). They start with marketing, as before; admin holds them always.

The blocks and their shapes are app/services/landing_content.py; the rows
app/models/content.py. Every change is on the audit trail.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.deps import DbSession
from app.core.api import ApiError, Data, UtcDateTime
from app.core.audit import AuditedDb
from app.core.auth import AuthUser, WebsiteOrUser
from app.core.clock import utc_now_ms
from app.core.permissions import Permission, has_permission, require_permission
from app.models.content import ContentBlock, ContentRevision
from app.models.identity import User
from app.services.landing_content import BLOCK_VERSION, BLOCKS, App, BlockSpec, Group, blocks_for, validate_body

router = APIRouter()

EDIT, PUBLISH = Permission.landing_edit, Permission.landing_publish
Editor = Annotated[AuthUser, Depends(require_permission(EDIT))]
Publisher = Annotated[AuthUser, Depends(require_permission(PUBLISH))]
Reader = Annotated[AuthUser, Depends(require_permission(EDIT, PUBLISH))]


# --- the pages' read ---------------------------------------------------------


class LandingBlock(BaseModel):
    key: str
    visible: bool
    body: dict[str, Any] | None  # None when hidden
    revision: int  # 0: the built-in text


class LandingOut(BaseModel):
    app: App
    version: int  # the bodies' format (BLOCK_VERSION)
    blocks: list[LandingBlock]


@router.get("/content/landing")
def landing(
    db: DbSession,
    caller: WebsiteOrUser,
    app: Annotated[App, Query()],
    preview: Annotated[bool, Query()] = False,
) -> Data[LandingOut]:
    """What an app's landing page shows, block by block, in page order."""
    if preview and not has_permission(db, caller, EDIT, PUBLISH):
        raise ApiError(403, "forbidden", "Only the roles that edit the landing pages can preview drafts.")
    specs = blocks_for(app)
    rows = {r.key: r for r in db.scalars(select(ContentBlock).where(ContentBlock.key.in_([s.key for s in specs])))}
    out = []
    for spec in specs:
        body, visible, revision = _published(spec, rows.get(spec.key))
        row = rows.get(spec.key)
        if preview and row is not None and row.draft_body is not None:
            body, visible = row.draft_body, bool(row.draft_visible)
        out.append(LandingBlock(key=spec.key, visible=visible, body=body if visible else None, revision=revision))
    return Data(data=LandingOut(app=app, version=BLOCK_VERSION, blocks=out))


def _published(spec: BlockSpec, row: ContentBlock | None) -> tuple[dict[str, Any], bool, int]:
    if row is None or row.published_body is None:
        return spec.default, True, 0
    return row.published_body, row.published_visible, row.revision


# --- marketing's editor ------------------------------------------------------


class Published(BaseModel):
    body: dict[str, Any]
    visible: bool
    revision: int
    published_at: UtcDateTime | None
    published_by: str | None  # a name


class Draft(BaseModel):
    body: dict[str, Any]
    visible: bool
    updated_at: UtcDateTime | None
    updated_by: str | None


class BlockOut(BaseModel):
    key: str
    group: Group
    label: str
    version: int
    default: dict[str, Any]
    published: Published
    draft: Draft | None


class DraftIn(BaseModel):
    body: dict[str, Any]
    visible: bool = True


class RevisionOut(BaseModel):
    number: int
    body: dict[str, Any]
    visible: bool
    published_at: UtcDateTime
    published_by: str | None


def _spec(key: str) -> BlockSpec:
    spec = BLOCKS.get(key)
    if spec is None:
        raise ApiError(404, "not_found", "No such block.")
    return spec


def _name(db: DbSession, user_id: str | None) -> str | None:
    if user_id is None:
        return None
    user = db.get(User, user_id)
    return user.full_name if user else None


def _out(db: DbSession, spec: BlockSpec, row: ContentBlock | None) -> BlockOut:
    body, visible, revision = _published(spec, row)
    published = Published(
        body=body,
        visible=visible,
        revision=revision,
        published_at=row.published_at if row else None,
        published_by=_name(db, row.published_by) if row else None,
    )
    draft = None
    if row is not None and row.draft_body is not None:
        draft = Draft(
            body=row.draft_body,
            visible=bool(row.draft_visible),
            updated_at=row.draft_updated_at,
            updated_by=_name(db, row.draft_updated_by),
        )
    return BlockOut(
        key=spec.key, group=spec.group, label=spec.label, version=BLOCK_VERSION, default=spec.default, published=published, draft=draft
    )


def _locked(db: AuditedDb, key: str) -> ContentBlock | None:
    return db.scalar(select(ContentBlock).where(ContentBlock.key == key).with_for_update())


@router.get("/content/blocks")
def list_blocks(db: DbSession, _reader: Reader, group: Annotated[Group | None, Query()] = None) -> Data[list[BlockOut]]:
    """Every block, in page order, with its published version and any draft."""
    rows = {r.key: r for r in db.scalars(select(ContentBlock))}
    return Data(data=[_out(db, s, rows.get(s.key)) for s in BLOCKS.values() if group is None or s.group == group])


@router.get("/content/blocks/{key}")
def get_block(key: str, db: DbSession, _reader: Reader) -> Data[BlockOut]:
    spec = _spec(key)
    return Data(data=_out(db, spec, db.get(ContentBlock, key)))


@router.put("/content/blocks/{key}/draft")
def save_draft(key: str, body: DraftIn, db: AuditedDb, editor: Editor) -> Data[BlockOut]:
    """Saves the draft: checked against the block's shape, not yet shown."""
    spec = _spec(key)
    try:
        checked = validate_body(spec, body.body)
    except ValidationError as err:
        raise ApiError(400, "validation_error", "The block's content isn't valid.", {"issues": _issues(err)}) from None
    try:
        row = _write_draft(db, key, checked, body.visible, editor.user_id)
    except IntegrityError:
        db.rollback()
        row = _write_draft(db, key, checked, body.visible, editor.user_id)  # created meanwhile: update it
    return Data(data=_out(db, spec, row))


def _write_draft(db: AuditedDb, key: str, body: dict[str, Any], visible: bool, user_id: str) -> ContentBlock:
    row = _locked(db, key)
    if row is None:
        row = ContentBlock(key=key)
        db.add(row)
    row.draft_body = body
    row.draft_visible = visible
    row.draft_updated_at = utc_now_ms()
    row.draft_updated_by = user_id
    db.commit()
    db.refresh(row)
    return row


@router.post("/content/blocks/{key}/publish")
def publish(key: str, db: AuditedDb, editor: Publisher) -> Data[BlockOut]:
    """Makes the draft what visitors see, and keeps it as a revision."""
    spec = _spec(key)
    row = _locked(db, key)
    if row is None or row.draft_body is None:
        raise ApiError(409, "no_draft", "There is no draft to publish.")
    # Re-checked: the shape may have tightened since the draft was saved.
    try:
        body = validate_body(spec, row.draft_body)
    except ValidationError as err:
        raise ApiError(400, "validation_error", "The draft no longer fits this block; edit and save it again.", {"issues": _issues(err)}) from None
    now = utc_now_ms()
    row.revision += 1
    db.add(ContentRevision(block_key=key, number=row.revision, body=body, visible=bool(row.draft_visible), published_by=editor.user_id, published_at=now))
    row.published_body = body
    row.published_visible = bool(row.draft_visible)
    row.published_at = now
    row.published_by = editor.user_id
    row.draft_body = None
    row.draft_visible = None
    row.draft_updated_at = None
    row.draft_updated_by = None
    db.commit()
    db.refresh(row)
    return Data(data=_out(db, spec, row))


@router.post("/content/blocks/{key}/discard")
def discard(key: str, db: AuditedDb, _editor: Editor) -> Data[BlockOut]:
    """Drops the draft; the published version stays."""
    spec = _spec(key)
    row = _locked(db, key)
    if row is not None and row.draft_body is not None:
        row.draft_body = None
        row.draft_visible = None
        row.draft_updated_at = None
        row.draft_updated_by = None
        db.commit()
        db.refresh(row)
    return Data(data=_out(db, spec, row))


@router.get("/content/blocks/{key}/revisions")
def revisions(key: str, db: DbSession, _reader: Reader) -> Data[list[RevisionOut]]:
    """Every publish of the block, newest first."""
    _spec(key)
    rows = db.scalars(select(ContentRevision).where(ContentRevision.block_key == key).order_by(ContentRevision.number.desc()))
    return Data(
        data=[
            RevisionOut(number=r.number, body=r.body, visible=r.visible, published_at=r.published_at, published_by=_name(db, r.published_by))
            for r in rows
        ]
    )


@router.post("/content/blocks/{key}/revisions/{number}/restore")
def restore(key: str, number: int, db: AuditedDb, editor: Editor) -> Data[BlockOut]:
    """Copies an earlier revision into the draft, to review and publish."""
    spec = _spec(key)
    revision = db.scalar(select(ContentRevision).where(ContentRevision.block_key == key, ContentRevision.number == number))
    if revision is None:
        raise ApiError(404, "not_found", "No such revision.")
    row = _write_draft(db, key, revision.body, revision.visible, editor.user_id)
    return Data(data=_out(db, spec, row))


def _issues(err: ValidationError) -> list[dict[str, Any]]:
    # Where and why, for the editor's form; never the value itself.
    return [{"loc": list(e["loc"]), "msg": e["msg"]} for e in err.errors(include_url=False, include_context=False, include_input=False)]

