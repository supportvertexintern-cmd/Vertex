"""System settings (the admin's "Global settings"), owned by FastAPI since
the reference-data handover (backend plan step 2.3).

They answer as Next.js's /api/admin/settings did, which now passes requests
on through callBackend(): admin only, the same three keys, the same 400 for
a bad intake mode. Next.js unwraps {data} so its page still gets the plain
key-value map. Not audited, as in Next.js.

Reads stay in Next.js: /api/apply/options reads intake_mode and /api/chat
reads ai_enabled (vertex_web keeps SELECT).
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field, StrictBool
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert

from app.api.deps import DbSession
from app.core.api import ApiError, Data
from app.core.auth import AuthUser
from app.core.rbac import require_role
from app.models.enums import Role
from app.models.reference import SystemSetting

router = APIRouter()

AdminUser = Annotated[AuthUser, Depends(require_role(Role.admin))]

INTAKE_MODES: frozenset[str] = frozenset({"email", "crm"})


class SettingsIn(BaseModel):
    """The keys the admin may set; any other key is ignored, as in Next.js."""

    model_config = ConfigDict(extra="ignore")

    ai_enabled: StrictBool | Literal["true", "false"] | None = None
    whatsapp_number: str | None = Field(default=None, max_length=30)
    intake_mode: str | None = None


def _settings(db: DbSession) -> dict[str, str]:
    return {s.key: s.value for s in db.scalars(select(SystemSetting).order_by(SystemSetting.key))}


def _as_text(value: str | bool) -> str:
    # Stored as text, as Next.js's String(value) did.
    return str(value).lower() if isinstance(value, bool) else value


@router.get("/settings")
def get_settings(db: DbSession, _admin: AdminUser) -> Data[dict[str, str]]:
    """Every setting, as a key-value map."""
    return Data(data=_settings(db))


@router.put("/settings")
def update_settings(body: SettingsIn, db: DbSession, _admin: AdminUser) -> Data[dict[str, str]]:
    """Sets the keys present in the body, in one transaction."""
    if body.intake_mode is not None and body.intake_mode not in INTAKE_MODES:
        raise ApiError(400, "validation_error", "intake_mode must be 'email' or 'crm'")

    for key, value in body.model_dump(exclude_none=True).items():
        text = _as_text(value)
        db.execute(
            insert(SystemSetting)
            .values(key=key, value=text)
            .on_conflict_do_update(index_elements=[SystemSetting.key], set_={"value": text, "updated_at": func.current_timestamp()})
        )
    db.commit()
    return Data(data=_settings(db))
