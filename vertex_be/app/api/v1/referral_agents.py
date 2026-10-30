"""Referral agents, owned by FastAPI from users and sessions step 8.1
(docs/architecture/users-handover.md): a director or admin sets an agent's
referral target for a period, replacing POST
/api/admin/referral-agents/[id]/targets, which now passes requests on.

It answers as that route did: the same roles (a test fails if the lists
drift), messages, status codes and Prisma-shaped JSON. One difference: a
date the website's new Date() couldn't read was a 500 there and is a 422
here. The target-vs-actual read (GET) stays in Next.js. Every change is on
the audit trail (ReferralAgentTarget is in AUDITED_MODELS).

The agent itself (registration, verification, approval) moves with the
accounts in step 8.4.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic_core import PydanticCustomError

from app.core.api import ApiError, Data, UtcDateTime, js_date
from app.core.audit import AuditedDb
from app.core.auth import AuthUser
from app.core.rbac import REFERRAL_AGENT_MANAGER_ROLES, require_role
from app.models.referral import ReferralAgent, ReferralAgentTarget

router = APIRouter()

Manager = Annotated[AuthUser, Depends(require_role(*REFERRAL_AGENT_MANAGER_ROLES))]


def _required_date(message: str):
    """createReferralAgentTargetSchema's z.string().min(1, message), then the
    website's new Date(value)."""

    def check(value: object) -> object:
        if isinstance(value, str):
            if not value:
                raise PydanticCustomError("value_error", message)
            return js_date(value)
        return value

    return check


class TargetIn(BaseModel):
    period_start: datetime
    period_end: datetime
    target_referrals: int = Field(ge=0)  # z.coerce.number().int().min(0)

    _start = field_validator("period_start", mode="before")(_required_date("Start date is required"))
    _end = field_validator("period_end", mode="before")(_required_date("End date is required"))


class TargetRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    referral_agent_id: str
    period_start: UtcDateTime
    period_end: UtcDateTime
    target_referrals: int
    set_by: str
    created_at: UtcDateTime
    updated_at: UtcDateTime


@router.post("/referral-agents/{agent_id}/targets", status_code=status.HTTP_201_CREATED, response_model=Data[TargetRow])
def create_target(agent_id: str, body: TargetIn, user: Manager, db: AuditedDb):
    if db.get(ReferralAgent, agent_id) is None:
        raise ApiError(404, "not_found", "Referral agent not found.")
    target = ReferralAgentTarget(
        referral_agent_id=agent_id,
        period_start=body.period_start,
        period_end=body.period_end,
        target_referrals=body.target_referrals,
        set_by=user.user_id,
    )
    db.add(target)
    db.commit()
    db.refresh(target)
    return {"data": target}
