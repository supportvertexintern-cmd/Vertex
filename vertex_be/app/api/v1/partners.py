"""The partners area (backend plan step 4): employer clients, owned by
FastAPI since step 4.1.

They answer as Next.js's /api/admin/employer-clients routes did, which now
pass requests on through callBackend(): the same roles (tests fail if the
lists drift), the rules of create/updateEmployerClientSchema field for
field, the same messages, status codes and Prisma-shaped JSON. Every
change is on the audit trail (EmployerClient is in AUDITED_MODELS).
"""

from __future__ import annotations

from typing import Annotated, TypeAlias

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select

from app.api.deps import DbSession
from app.core.api import ApiError, Data, Email, UtcDateTime
from app.core.audit import AuditedDb
from app.core.auth import AuthUser
from app.core.rbac import require_role
from app.models.enums import EmployerClientStatus, JobStatus, Role
from app.models.jobs import EmployerClient, Job

router = APIRouter()

# Marketing reads the list to link a job posting to a client.
EMPLOYER_CLIENT_READERS: tuple[Role, ...] = (Role.marketing, Role.director, Role.admin)
# In-House Supervisor no longer manages them (confirmed with the business).
EMPLOYER_CLIENT_MANAGERS: tuple[Role, ...] = (Role.director, Role.admin)

Reader: TypeAlias = Annotated[AuthUser, Depends(require_role(*EMPLOYER_CLIENT_READERS))]
Manager: TypeAlias = Annotated[AuthUser, Depends(require_role(*EMPLOYER_CLIENT_MANAGERS))]


class EmployerClientOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    country: str
    industry: str | None
    contact_name: str
    contact_email: str
    contact_phone: str
    status: EmployerClientStatus
    notes: str | None
    created_at: UtcDateTime
    updated_at: UtcDateTime


class JobCount(BaseModel):
    jobs: int


class EmployerClientListItem(EmployerClientOut):
    # Prisma's include: { _count: { select: { jobs: true } } }
    count: JobCount = Field(serialization_alias="_count")


class LinkedJob(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    country: str
    city: str
    status: JobStatus
    created_at: UtcDateTime


class EmployerClientDetail(EmployerClientOut):
    jobs: list[LinkedJob]


class EmployerClientCreate(BaseModel):
    name: str = Field(min_length=2, max_length=150)
    country: str = Field(min_length=2, max_length=100)
    industry: str | None = Field(default=None, max_length=100)
    contact_name: str = Field(min_length=2, max_length=150)
    contact_email: Email
    contact_phone: str = Field(min_length=3, max_length=30)
    notes: str | None = Field(default=None, max_length=2000)


class EmployerClientUpdate(BaseModel):
    """Only the fields sent change. The required columns refuse an explicit
    null; industry and notes take it to clear the column."""

    name: str = Field(default=None, min_length=2, max_length=150)  # type: ignore[assignment]
    country: str = Field(default=None, min_length=2, max_length=100)  # type: ignore[assignment]
    industry: str | None = Field(default=None, max_length=100)
    contact_name: str = Field(default=None, min_length=2, max_length=150)  # type: ignore[assignment]
    contact_email: Email = None  # type: ignore[assignment]
    contact_phone: str = Field(default=None, min_length=3, max_length=30)  # type: ignore[assignment]
    status: EmployerClientStatus = None  # type: ignore[assignment]
    notes: str | None = Field(default=None, max_length=2000)


def _not_found() -> ApiError:
    return ApiError(404, "not_found", "Employer/client not found.")


@router.get("/employer-clients")
def list_employer_clients(db: DbSession, _user: Reader) -> Data[list[EmployerClientListItem]]:
    """Every client, by name, with how many jobs each has."""
    job_counts = select(Job.employer_client_id, func.count(Job.id).label("n")).group_by(Job.employer_client_id).subquery()
    rows = db.execute(
        select(EmployerClient, func.coalesce(job_counts.c.n, 0))
        .outerjoin(job_counts, job_counts.c.employer_client_id == EmployerClient.id)
        .order_by(EmployerClient.name)
    )
    return Data(
        data=[
            EmployerClientListItem(**EmployerClientOut.model_validate(client).model_dump(), count=JobCount(jobs=n))
            for client, n in rows
        ]
    )


@router.get("/employer-clients/{client_id}")
def get_employer_client(client_id: str, db: DbSession, _user: Reader) -> Data[EmployerClientDetail]:
    """One client, with its linked jobs, newest first."""
    client = db.get(EmployerClient, client_id)
    if client is None:
        raise _not_found()
    jobs = db.scalars(select(Job).where(Job.employer_client_id == client_id).order_by(Job.created_at.desc()))
    return Data(
        data=EmployerClientDetail(
            **EmployerClientOut.model_validate(client).model_dump(), jobs=[LinkedJob.model_validate(j) for j in jobs]
        )
    )


@router.post("/employer-clients", status_code=status.HTTP_201_CREATED)
def create_employer_client(body: EmployerClientCreate, db: AuditedDb, _user: Manager) -> Data[EmployerClientOut]:
    client = EmployerClient(**body.model_dump(exclude_none=True))
    db.add(client)
    db.commit()
    db.refresh(client)
    return Data(data=EmployerClientOut.model_validate(client))


@router.patch("/employer-clients/{client_id}")
def update_employer_client(client_id: str, body: EmployerClientUpdate, db: AuditedDb, _user: Manager) -> Data[EmployerClientOut]:
    client = db.get(EmployerClient, client_id)
    if client is None:
        raise _not_found()
    for field in body.model_fields_set:
        setattr(client, field, getattr(body, field))
    db.commit()
    db.refresh(client)
    return Data(data=EmployerClientOut.model_validate(client))
