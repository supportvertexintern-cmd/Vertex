"""Knowledge articles and email templates, owned by FastAPI since the content
handover (backend plan step 3.1).

They answer as Next.js's /api/admin/knowledge and /api/admin/emails did,
which now pass requests on through callBackend(): admin only, the same 400
"Missing required fields", the same Prisma-shaped JSON. Next.js unwraps
{data} so the admin Settings page still gets plain arrays and objects.
Every change is on the audit trail.

Reads stay in Next.js: the Help Center and /api/chat read the articles, and
lib/email.ts reads a template before sending (vertex_web keeps SELECT).
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.deps import DbSession
from app.core.api import ApiError, Data, UtcDateTime
from app.core.audit import AuditedDb
from app.core.auth import AuthUser
from app.core.rbac import require_role
from app.models.enums import Role
from app.models.reference import EmailTemplate, KnowledgeArticle

router = APIRouter()

AdminUser = Annotated[AuthUser, Depends(require_role(Role.admin))]

UNIQUE_VIOLATION = "23505"


def _missing_fields() -> ApiError:
    return ApiError(400, "validation_error", "Missing required fields")


# --- knowledge articles ------------------------------------------------------


class ArticleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    category: str
    content: str
    created_at: UtcDateTime
    updated_at: UtcDateTime


class ArticleIn(BaseModel):
    # Optional here so a missing field is Next.js's 400, not a 422.
    title: str | None = Field(default=None, max_length=300)
    category: str | None = Field(default=None, max_length=100)
    content: str | None = Field(default=None, max_length=100_000)


@router.get("/knowledge")
def list_articles(db: DbSession, _admin: AdminUser) -> Data[list[ArticleOut]]:
    """Every article, by category."""
    rows = db.scalars(select(KnowledgeArticle).order_by(KnowledgeArticle.category, KnowledgeArticle.created_at))
    return Data(data=[ArticleOut.model_validate(a) for a in rows])


@router.post("/knowledge", status_code=status.HTTP_201_CREATED)
def create_article(body: ArticleIn, db: AuditedDb, _admin: AdminUser) -> Data[ArticleOut]:
    if not body.title or not body.content:
        raise _missing_fields()
    article = KnowledgeArticle(title=body.title, category=body.category or "General", content=body.content)
    db.add(article)
    db.commit()
    db.refresh(article)
    return Data(data=ArticleOut.model_validate(article))


@router.delete("/knowledge/{article_id}")
def delete_article(article_id: str, db: AuditedDb, _admin: AdminUser) -> Data[dict[str, str]]:
    article = db.get(KnowledgeArticle, article_id)
    if article is None:
        raise ApiError(404, "not_found", "Article not found.")
    db.delete(article)
    db.commit()
    return Data(data={"id": article_id})


# --- email templates ---------------------------------------------------------


class TemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    event: str
    subject: str
    body_html: str
    updated_at: UtcDateTime


class TemplateIn(BaseModel):
    event: str | None = Field(default=None, max_length=100)
    subject: str | None = Field(default=None, max_length=300)
    body_html: str | None = Field(default=None, max_length=200_000)


@router.get("/email-templates")
def list_templates(db: DbSession, _admin: AdminUser) -> Data[list[TemplateOut]]:
    """Every template override, by event."""
    return Data(data=[TemplateOut.model_validate(t) for t in db.scalars(select(EmailTemplate).order_by(EmailTemplate.event))])


@router.put("/email-templates")
def save_template(body: TemplateIn, db: AuditedDb, _admin: AdminUser) -> Data[TemplateOut]:
    """Creates or replaces the override for body.event."""
    if not body.event or not body.subject or not body.body_html:
        raise _missing_fields()
    try:
        template = _write_template(db, body.event, body.subject, body.body_html)
    except IntegrityError as err:
        db.rollback()
        if getattr(err.orig, "pgcode", None) != UNIQUE_VIOLATION:
            raise
        template = _write_template(db, body.event, body.subject, body.body_html)  # made meanwhile: update it
    return Data(data=TemplateOut.model_validate(template))


def _write_template(db: AuditedDb, event: str, subject: str, body_html: str) -> EmailTemplate:
    # Through the ORM, so the change is on the audit trail.
    template = db.get(EmailTemplate, event)
    if template is None:
        template = EmailTemplate(event=event, subject=subject, body_html=body_html)
        db.add(template)
    else:
        template.subject = subject
        template.body_html = body_html
    db.commit()
    db.refresh(template)
    return template
