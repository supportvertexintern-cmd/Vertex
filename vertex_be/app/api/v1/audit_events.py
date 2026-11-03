"""The audit rows the website still writes (reads handover R7a, D3 A): it
records them here instead of in the database, so it needs no write on
AuditLog. Only the website may call (its service credential), with the
signed-in user's session when there is one; the actor is that session's
user, never a name in the body.

  - security events it decides itself: a sign-in refused by its own rate
    limit, a denial by its early role check, a download link that didn't
    verify, a file served for a link. They go through
    record_security_event, so the alert monitor sees them too.
  - an export (auditAccess): recorded before the data leaves, and the
    export fails if it can't be (503), as before.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, ConfigDict, Field

from app.core.api import ApiError, Data
from app.core.audit import append_event, record_security_event
from app.core.auth import OptionalUser, calling_service

router = APIRouter()

WebsiteSecurityAction = Literal["login_rate_limited", "access_denied", "document_link_rejected", "document_downloaded"]


class AuditEventIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: WebsiteSecurityAction | Literal["export"]
    entity_type: str = Field(min_length=1, max_length=100)
    entity_id: str = Field(default="", max_length=200)
    # Never credentials or file contents; redacted regardless.
    detail: dict[str, Any] = Field(default_factory=dict)


class Recorded(BaseModel):
    action: str


@router.post("/audit-events", response_model=Data[Recorded], status_code=status.HTTP_201_CREATED, dependencies=[Depends(calling_service)])
def record(body: AuditEventIn, user: OptionalUser) -> dict[str, Any]:
    actor_id = user.user_id if user else None
    if body.action == "export":
        if actor_id is None:
            raise ApiError(401, "unauthorized", "An export is recorded for a signed-in user.")
        try:
            append_event("export", actor_id=actor_id, entity_type=body.entity_type, entity_id=body.entity_id or "bulk", detail=body.detail)
        except Exception:  # noqa: BLE001
            raise ApiError(503, "audit_unavailable", "The export couldn't be recorded, so it wasn't made.") from None
    else:
        record_security_event(body.action, actor_id=actor_id, entity_type=body.entity_type, entity_id=body.entity_id, detail=body.detail)
    return {"data": {"action": body.action}}
