"""Milestone-payment fee policy (SRS FR-4.5): reads (backend plan step 1.1).

GET /fee-policy answers exactly as GET /api/fee-policy in Next.js
(vertex/src/app/api/fee-policy/route.ts): the same roles, the same order,
and each policy in Prisma's shape with its country's name, so in step 1.3
Next.js can pass this answer straight on. tests/test_fee_policy.py fails CI
if the role lists drift apart.

Writes stay in Next.js until step 1.2.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import joinedload

from app.api.deps import DbSession
from app.core.api import Data, UtcDateTime
from app.core.auth import AuthUser
from app.core.rbac import require_role
from app.models.cases import FeePolicy
from app.models.enums import Role

router = APIRouter()

# Every staff role that sees a case: CaseDetail loads the policy on every
# case page to show its "Milestone payments not enabled" banner. Only
# director and admin may change it (step 1.2).
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
