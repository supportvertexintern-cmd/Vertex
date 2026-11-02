"""Referral agents, their commissions and the commission rules, read
(reads handover R2). They answer as the website's /api/admin/referral-
agents*, /api/admin/referral-commission*, and /api/referral-agent/* routes
read them through Prisma, which now ask here instead: the same roles, rows,
order and JSON keys. The writes are in referral_agents.py and
referral_commissions.py.

Directors and admins see everything (REFERRAL_AGENT_MANAGER_ROLES); a
referral agent sees only their own record, candidates and commissions,
found by their user id. The website builds the agent's referral link and QR
code from referral_code: FastAPI doesn't know the website's address.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select

from app.api.deps import DbSession
from app.api.v1.referral_agents import AgentRow
from app.api.v1.referral_commissions import CommissionRow, RuleRow
from app.core.api import ApiError, Data, UtcDateTime
from app.core.auth import AuthUser
from app.core.rbac import REFERRAL_AGENT_MANAGER_ROLES, require_role
from app.models.candidate import Application, Candidate
from app.models.cases import Case
from app.models.enums import CandidateLifecycleStatus, CaseStage, JobStatus, ReferralAgentStatus, ReferralCommissionStatus, ReferralMilestone, Role
from app.models.identity import Country
from app.models.jobs import Job
from app.models.referral import ReferralAgent, ReferralCommission, ReferralCommissionRule

router = APIRouter()

Manager = Annotated[AuthUser, Depends(require_role(*REFERRAL_AGENT_MANAGER_ROLES))]
Agent = Annotated[AuthUser, Depends(require_role(Role.referral_agent))]


# --- output --------------------------------------------------------------------


class Ref(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str


class PersonRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    full_name: str


class AgentCounts(BaseModel):
    candidates: int
    commissions: int


class AgentListRow(AgentRow):
    countryRef: Ref | None  # noqa: N815  (Prisma's relation name)
    count: AgentCounts = Field(serialization_alias="_count")


class ReferredCandidate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    full_name: str
    lifecycle_status: CandidateLifecycleStatus
    referral_duplicate_flag: bool
    created_at: UtcDateTime


class AgentCommission(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    milestone: ReferralMilestone
    amount: float
    currency: str
    status: ReferralCommissionStatus
    created_at: UtcDateTime
    candidate: PersonRef


class AgentDetail(AgentRow):
    countryRef: Ref | None  # noqa: N815
    candidates: list[ReferredCandidate]
    commissions: list[AgentCommission]


class CountryRow(BaseModel):
    id: str
    name: str
    activeAgents: int  # noqa: N815  (the page's field names)
    candidatesReferred: int  # noqa: N815
    pendingCommissionTotal: float  # noqa: N815


class CandidateCount(BaseModel):
    candidates: int


class SummaryAgent(BaseModel):
    id: str
    full_name: str
    status: ReferralAgentStatus
    referral_code: str
    count: CandidateCount = Field(serialization_alias="_count")


class SummaryJob(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    city: str
    status: JobStatus


class Performance(BaseModel):
    """kpi.ts's ReferralAgentPerformance."""

    referralAgentId: str  # noqa: N815
    referralAgentName: str  # noqa: N815
    countryName: str | None  # noqa: N815
    totalReferrals: int  # noqa: N815
    qualified: int
    deployed: int
    totalCommissionEarned: float  # noqa: N815
    currency: str


class CountrySummary(BaseModel):
    country: Ref
    agents: list[SummaryAgent]
    milestoneCounts: dict[str, int]  # noqa: N815
    jobs: list[SummaryJob]
    performance: list[Performance]
    pendingCommissionTotal: float  # noqa: N815


class RuleListRow(RuleRow):
    country: Ref


class CommissionAgent(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    full_name: str
    email: str


class CommissionCandidate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    full_name: str
    country: Ref | None


class CommissionListRow(CommissionRow):
    referral_agent: CommissionAgent
    candidate: CommissionCandidate


class OwnCommission(CommissionRow):
    candidate: PersonRef


class OwnCandidate(ReferredCandidate):
    current_stage: CaseStage | None


class CommissionSummary(BaseModel):
    earned: float
    pending: float
    paid: float
    currency: str


class OwnProfile(BaseModel):
    """/api/referral-agent/me, less the link and QR code the website adds."""

    id: str
    full_name: str
    email: str
    status: ReferralAgentStatus
    country: str
    referral_code: str
    total_referrals: int
    milestone_counts: dict[str, int]
    commission_summary: CommissionSummary


# --- helpers -------------------------------------------------------------------


def _columns(row: Any, model: type[BaseModel]) -> dict[str, Any]:
    """A row's own fields, to add relations the row doesn't carry."""
    return {name: getattr(row, name) for name in model.model_fields if hasattr(row, name)}


def _country_ref(db: DbSession, country_id: str | None) -> Ref | None:
    country = db.get(Country, country_id) if country_id else None
    return Ref.model_validate(country) if country else None


def _milestone_counts(milestones: list[ReferralMilestone]) -> dict[str, int]:
    """Every milestone, zero when none (the pages read all six keys)."""
    counts = {m.value: 0 for m in ReferralMilestone}
    for m in milestones:
        counts[m.value] += 1
    return counts


def _pending_total(db: DbSession, country_id: str) -> float:
    return db.scalar(
        select(func.coalesce(func.sum(ReferralCommission.amount), 0))
        .join(Candidate, Candidate.id == ReferralCommission.candidate_id)
        .where(ReferralCommission.status == ReferralCommissionStatus.pending, Candidate.country_id == country_id)
    ) or 0.0


def _count_by(db: DbSession, column: Any, *where: Any) -> dict[str, int]:
    return dict(db.execute(select(column, func.count()).where(column.is_not(None), *where).group_by(column)).all())


def _performance(db: DbSession, country_id: str | None) -> list[Performance]:
    """kpi.ts's computeReferralAgentPerformance: every active agent (in the
    country, if given), by name, from the commission ledger."""
    query = select(ReferralAgent).where(ReferralAgent.status == ReferralAgentStatus.active).order_by(ReferralAgent.full_name)
    if country_id:
        query = query.where(ReferralAgent.country_id == country_id)
    agents = list(db.scalars(query))
    referrals = _count_by(db, Candidate.referral_agent_id)
    out = []
    for a in agents:
        commissions = list(
            db.scalars(select(ReferralCommission).where(ReferralCommission.referral_agent_id == a.id).order_by(ReferralCommission.created_at))
        )
        country = _country_ref(db, a.country_id)
        out.append(Performance(
            referralAgentId=a.id,
            referralAgentName=a.full_name,
            countryName=country.name if country else None,
            totalReferrals=referrals.get(a.id, 0),
            qualified=sum(1 for c in commissions if c.milestone is ReferralMilestone.qualified),
            deployed=sum(1 for c in commissions if c.milestone is ReferralMilestone.deployed),
            totalCommissionEarned=sum(c.amount for c in commissions),
            currency=commissions[0].currency if commissions else "USD",
        ))
    return out


def _own_agent(db: DbSession, user: AuthUser) -> ReferralAgent:
    agent = db.scalars(select(ReferralAgent).where(ReferralAgent.user_id == user.user_id)).first()
    if agent is None:
        raise ApiError(404, "not_found", "Referral agent record not found.")
    return agent


# --- directors and admins -------------------------------------------------------
# The fixed paths come before /referral-agents/{agent_id}.


@router.get("/referral-agents/countries", response_model=Data[list[CountryRow]])
def referral_countries(db: DbSession, _user: Manager):
    """Every country, by name, with its active agents, referred candidates
    and pending commissions."""
    active = _count_by(db, ReferralAgent.country_id, ReferralAgent.status == ReferralAgentStatus.active)
    referred = _count_by(db, Candidate.country_id, Candidate.referral_agent_id.is_not(None))
    pending = dict(db.execute(
        select(Candidate.country_id, func.sum(ReferralCommission.amount))
        .join(Candidate, Candidate.id == ReferralCommission.candidate_id)
        .where(ReferralCommission.status == ReferralCommissionStatus.pending, Candidate.country_id.is_not(None))
        .group_by(Candidate.country_id)
    ).all())
    return Data(data=[
        CountryRow(id=c.id, name=c.name, activeAgents=active.get(c.id, 0), candidatesReferred=referred.get(c.id, 0),
                   pendingCommissionTotal=pending.get(c.id) or 0)
        for c in db.scalars(select(Country).order_by(Country.name))
    ])


@router.get("/referral-agents/countries/{country_id}/summary", response_model=Data[CountrySummary])
def referral_country_summary(country_id: str, db: DbSession, _user: Manager):
    """One country: its agents, commissions by milestone, the jobs there,
    each active agent's performance and the pending commissions."""
    country = db.get(Country, country_id)
    if country is None:
        raise ApiError(404, "not_found", "Country not found.")
    agents = list(db.scalars(select(ReferralAgent).where(ReferralAgent.country_id == country_id).order_by(ReferralAgent.full_name)))
    referrals = _count_by(db, Candidate.referral_agent_id)
    milestones = list(db.scalars(
        select(ReferralCommission.milestone).join(Candidate, Candidate.id == ReferralCommission.candidate_id).where(Candidate.country_id == country_id)
    ))
    jobs = db.scalars(select(Job).where(func.lower(Job.country) == country.name.lower()).order_by(Job.title))
    return Data(data=CountrySummary(
        country=Ref.model_validate(country),
        agents=[SummaryAgent(id=a.id, full_name=a.full_name, status=a.status, referral_code=a.referral_code,
                             count=CandidateCount(candidates=referrals.get(a.id, 0))) for a in agents],
        milestoneCounts=_milestone_counts(milestones),
        jobs=[SummaryJob.model_validate(j) for j in jobs],
        performance=_performance(db, country_id),
        pendingCommissionTotal=_pending_total(db, country_id),
    ))


@router.get("/referral-agents/performance", response_model=Data[list[Performance]])
def referral_performance(db: DbSession, _user: Manager, countryId: str | None = None):  # noqa: N803
    return Data(data=_performance(db, countryId or None))


@router.get("/referral-agents", response_model=Data[list[AgentListRow]])
def list_referral_agents(db: DbSession, _user: Manager, countryId: str | None = None):  # noqa: N803
    """Every agent (in the country, if given), newest first, with counts."""
    query = select(ReferralAgent).order_by(ReferralAgent.created_at.desc())
    if countryId:
        query = query.where(ReferralAgent.country_id == countryId)
    candidates = _count_by(db, Candidate.referral_agent_id)
    commissions = _count_by(db, ReferralCommission.referral_agent_id)
    return Data(data=[
        AgentListRow.model_validate(_columns(a, AgentRow) | {
            "countryRef": _country_ref(db, a.country_id),
            "count": {"candidates": candidates.get(a.id, 0), "commissions": commissions.get(a.id, 0)},
        })
        for a in db.scalars(query)
    ])


@router.get("/referral-agents/{agent_id}", response_model=Data[AgentDetail])
def get_referral_agent(agent_id: str, db: DbSession, _user: Manager):
    """An agent with their referred candidates and commissions, newest first."""
    agent = db.get(ReferralAgent, agent_id)
    if agent is None:
        raise ApiError(404, "not_found", "Referral agent not found.")
    candidates = db.scalars(select(Candidate).where(Candidate.referral_agent_id == agent.id).order_by(Candidate.created_at.desc()))
    commissions = db.scalars(select(ReferralCommission).where(ReferralCommission.referral_agent_id == agent.id).order_by(ReferralCommission.created_at.desc()))
    return Data(data=AgentDetail.model_validate(_columns(agent, AgentRow) | {
        "countryRef": _country_ref(db, agent.country_id),
        "candidates": [ReferredCandidate.model_validate(c) for c in candidates],
        "commissions": [AgentCommission.model_validate(c) for c in commissions],
    }))


@router.get("/referral-commission-rules", response_model=Data[list[RuleListRow]])
def list_commission_rules(db: DbSession, _user: Manager, countryId: str | None = None):  # noqa: N803
    """Every rule (in the country, if given), by country name and milestone."""
    query = (
        select(ReferralCommissionRule).join(Country, Country.id == ReferralCommissionRule.country_id)
        .order_by(Country.name, ReferralCommissionRule.milestone)
    )
    if countryId:
        query = query.where(ReferralCommissionRule.country_id == countryId)
    return Data(data=[RuleListRow.model_validate(_columns(r, RuleRow) | {"country": Ref.model_validate(r.country)}) for r in db.scalars(query)])


@router.get("/referral-commissions", response_model=Data[list[CommissionListRow]])
def list_commissions(
    db: DbSession,
    _user: Manager,
    countryId: str | None = None,  # noqa: N803
    agentId: str | None = None,  # noqa: N803
    status: ReferralCommissionStatus | None = None,
):
    """Commissions, newest first, by agent, status and candidate country."""
    query = select(ReferralCommission).order_by(ReferralCommission.created_at.desc())
    if agentId:
        query = query.where(ReferralCommission.referral_agent_id == agentId)
    if status:
        query = query.where(ReferralCommission.status == status)
    if countryId:
        query = query.join(Candidate, Candidate.id == ReferralCommission.candidate_id).where(Candidate.country_id == countryId)
    return Data(data=[
        CommissionListRow.model_validate(_columns(c, CommissionRow) | {
            "referral_agent": CommissionAgent.model_validate(c.referral_agent),
            "candidate": CommissionCandidate.model_validate(_columns(c.candidate, CommissionCandidate) | {"country": _country_ref(db, c.candidate.country_id)}),
        })
        for c in db.scalars(query)
    ])


# --- a referral agent's own -----------------------------------------------------


@router.get("/referral-agent/me", response_model=Data[OwnProfile])
def own_profile(db: DbSession, user: Agent):
    """The agent's profile, referral count, milestones and commission totals:
    earned (all), pending (pending or approved) and paid."""
    agent = _own_agent(db, user)
    commissions = list(db.scalars(select(ReferralCommission).where(ReferralCommission.referral_agent_id == agent.id).order_by(ReferralCommission.created_at)))
    country = _country_ref(db, agent.country_id)
    return Data(data=OwnProfile(
        id=agent.id, full_name=agent.full_name, email=agent.email, status=agent.status,
        country=country.name if country else agent.country,
        referral_code=agent.referral_code,
        total_referrals=db.scalar(select(func.count()).select_from(Candidate).where(Candidate.referral_agent_id == agent.id)) or 0,
        milestone_counts=_milestone_counts([c.milestone for c in commissions]),
        commission_summary=CommissionSummary(
            earned=sum(c.amount for c in commissions),
            pending=sum(c.amount for c in commissions if c.status in (ReferralCommissionStatus.pending, ReferralCommissionStatus.approved)),
            paid=sum(c.amount for c in commissions if c.status is ReferralCommissionStatus.paid),
            currency=commissions[0].currency if commissions else "USD",
        ),
    ))


@router.get("/referral-agent/candidates", response_model=Data[list[OwnCandidate]])
def own_candidates(db: DbSession, user: Agent):
    """The agent's referred candidates, newest first, each with the stage of
    the case behind their latest application."""
    agent = _own_agent(db, user)
    out = []
    for c in db.scalars(select(Candidate).where(Candidate.referral_agent_id == agent.id).order_by(Candidate.created_at.desc())):
        latest = db.scalars(select(Application.id).where(Application.candidate_id == c.id).order_by(Application.submitted_at.desc()).limit(1)).first()
        stage = db.scalar(select(Case.current_stage).where(Case.application_id == latest)) if latest else None
        out.append(OwnCandidate.model_validate(_columns(c, ReferredCandidate) | {"current_stage": stage}))
    return Data(data=out)


@router.get("/referral-agent/commissions", response_model=Data[list[OwnCommission]])
def own_commissions(db: DbSession, user: Agent):
    """The agent's commissions, newest first."""
    agent = _own_agent(db, user)
    rows = db.scalars(select(ReferralCommission).where(ReferralCommission.referral_agent_id == agent.id).order_by(ReferralCommission.created_at.desc()))
    return Data(data=[OwnCommission.model_validate(_columns(c, CommissionRow) | {"candidate": PersonRef.model_validate(c.candidate)}) for c in rows])
