"""Milestone-payment fee policy (SRS FR-4.5), owned by FastAPI since the
reference-data handover (backend plan steps 1.1 and 1.2).

GET /fee-policy answers exactly as GET /api/fee-policy in Next.js
(vertex/src/app/api/fee-policy/route.ts): the same roles, the same order,
and each policy in Prisma's shape with its country's name, so in step 1.3
Next.js can pass this answer straight on. tests/test_fee_policy.py fails CI
if the role lists drift apart.

POST /fee-policy is the only writer: Next.js's POST /api/fee-policy passes
the request on through callBackend(), and vertex_web may no longer write
the table (deploy/db-roles.sql). The input rules are those of Next.js's
former updateFeePolicySchema; one policy per country, null = the global
default.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import joinedload

from app.api.deps import DbSession
from app.core.api import ApiError, Data, UtcDateTime
from app.core.audit import AuditedDb
from app.core.auth import AuthUser
from app.core.rbac import require_role
from app.models.cases import FeePolicy
from app.models.enums import Role
from app.models.identity import Country

router = APIRouter()

# Every staff role that sees a case: CaseDetail loads the policy on every
# case page to show its "Milestone payments not enabled" banner.
FEE_POLICY_READERS: tuple[Role, ...] = (
    Role.regional_recruiter,
    Role.country_supervisor,
    Role.inhouse_supervisor,
    Role.director,
    Role.admin,
    Role.hr,
    Role.operations_team,
    Role.operations_director,
    Role.finance,
    Role.partner,
)

# Pricing lives per job now; the country policy is director/admin only
# (confirmed with the business; FEE_POLICY_MANAGER_ROLES in Next.js).
FEE_POLICY_MANAGERS: tuple[Role, ...] = (Role.director, Role.admin)


class CountryName(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str


class FeePolicyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    country_id: str | None
    enabled: bool
    documentation_amount: float | None
    permit_amount: float | None
    visa_amount: float | None
    currency: str
    updated_by: str
    updated_at: UtcDateTime
    # null for the global default
    country: CountryName | None


@router.get("/fee-policy")
def list_fee_policies(
    db: DbSession,
    _user: Annotated[AuthUser, Depends(require_role(*FEE_POLICY_READERS))],
) -> Data[list[FeePolicyOut]]:
    """Every policy, the most recently changed first."""
    policies = db.scalars(
        select(FeePolicy).options(joinedload(FeePolicy.country)).order_by(FeePolicy.updated_at.desc())
    ).all()
    return Data(data=[FeePolicyOut.model_validate(p) for p in policies])


class FeePolicyIn(BaseModel):
    """The rules of Next.js's updateFeePolicySchema, field for field (it was
    removed from vertex/src/lib/validations.ts when FastAPI took the writes)."""

    country_id: str | None = Field(default=None, pattern=r"^c[^\s-]{8,}$")
    enabled: bool
    documentation_amount: float | None = Field(default=None, gt=0)
    permit_amount: float | None = Field(default=None, gt=0)
    visa_amount: float | None = Field(default=None, gt=0)
    currency: str = Field(default="USD", min_length=3, max_length=3)


@router.post("/fee-policy")
def save_fee_policy(
    body: FeePolicyIn,
    db: AuditedDb,
    user: Annotated[AuthUser, Depends(require_role(*FEE_POLICY_MANAGERS))],
) -> Data[FeePolicyOut]:
    """Creates or replaces the policy for body.country_id (null = global)."""
    if body.country_id is not None and db.get(Country, body.country_id) is None:
        raise ApiError(422, "validation_error", "Validation failed", {"country_id": ["Unknown country"]})

    same_country = FeePolicy.country_id.is_(None) if body.country_id is None else FeePolicy.country_id == body.country_id
    policy = db.scalars(select(FeePolicy).where(same_country).limit(1)).first()
    if policy is None:
        policy = FeePolicy(country_id=body.country_id)
        db.add(policy)
    policy.enabled = body.enabled
    policy.documentation_amount = body.documentation_amount
    policy.permit_amount = body.permit_amount
    policy.visa_amount = body.visa_amount
    policy.currency = body.currency
    policy.updated_by = user.user_id
    db.commit()
    db.refresh(policy)
    return Data(data=FeePolicyOut.model_validate(policy))
