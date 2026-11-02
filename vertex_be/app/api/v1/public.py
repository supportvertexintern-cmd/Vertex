"""The reads anyone may make that aren't a job (reads handover R1): what the
application forms offer, the help centre's articles, and whether the
assistant is on. They answer as the website's /api/apply/options,
app/help/page.tsx and /api/chat read them through Prisma, which now ask
here instead.

Each takes the website, calling for a visitor, or a signed-in user calling
directly (WebsiteOrUser): the website rate-limits anonymous visitors.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select

from app.api.deps import DbSession
from app.api.v1.content import ArticleOut
from app.api.v1.reference import DocumentTypeOut
from app.core.api import Data
from app.core.auth import WebsiteOrUser
from app.models.identity import Country, Region
from app.models.reference import CountryDocumentRequirement, DocumentRequirementType, KnowledgeArticle, SystemSetting

router = APIRouter()

# Every programme Vertex places into is in this region.
DESTINATION_REGION = "Europe"


class CountryOption(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str


class RequirementOption(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    country_id: str
    document_type: str


class ApplyOptions(BaseModel):
    countries: list[CountryOption]
    locationCountries: list[CountryOption]  # noqa: N815  (the forms' field names)
    documentTypes: list[DocumentTypeOut]  # noqa: N815
    documentRequirements: list[RequirementOption]  # noqa: N815
    intakeMode: Literal["email", "crm"]  # noqa: N815


class AssistantOut(BaseModel):
    enabled: bool


def _setting(db: DbSession, key: str) -> str | None:
    return db.scalar(select(SystemSetting.value).where(SystemSetting.key == key))


@router.get("/apply/options")
def apply_options(db: DbSession, _caller: WebsiteOrUser) -> Data[ApplyOptions]:
    """The application forms' reference data: destination countries (the
    destination region), every other country, the document types and each
    destination's extra documents, and where a public application goes
    ("email" unless the admin set "crm", so an unset stack never writes to
    the CRM)."""
    by_name = select(Country).join(Region).order_by(Country.name)
    return Data(
        data=ApplyOptions(
            countries=[CountryOption.model_validate(c) for c in db.scalars(by_name.where(Region.name == DESTINATION_REGION))],
            locationCountries=[CountryOption.model_validate(c) for c in db.scalars(by_name.where(Region.name != DESTINATION_REGION))],
            documentTypes=[
                DocumentTypeOut.model_validate(t)
                for t in db.scalars(select(DocumentRequirementType).order_by(DocumentRequirementType.sort_order, DocumentRequirementType.created_at))
            ],
            documentRequirements=[RequirementOption.model_validate(r) for r in db.scalars(select(CountryDocumentRequirement))],
            intakeMode="crm" if _setting(db, "intake_mode") == "crm" else "email",
        )
    )


@router.get("/help/articles")
def help_articles(db: DbSession, _caller: WebsiteOrUser) -> Data[list[ArticleOut]]:
    """Every knowledge article, by category: the help centre shows them all,
    and the assistant answers from them."""
    rows = db.scalars(select(KnowledgeArticle).order_by(KnowledgeArticle.category, KnowledgeArticle.created_at))
    return Data(data=[ArticleOut.model_validate(a) for a in rows])


@router.get("/assistant")
def assistant(db: DbSession, _caller: WebsiteOrUser) -> Data[AssistantOut]:
    """Whether the assistant answers: on unless the admin turned it off."""
    return Data(data=AssistantOut(enabled=_setting(db, "ai_enabled") != "false"))
