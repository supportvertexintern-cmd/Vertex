from fastapi import APIRouter

from app.api.v1 import campaigns, candidates, content, fee_policy, geography, health, jobs, me, partners, reference, reports, scorecards, settings, targets

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(me.router, tags=["auth"])
api_router.include_router(fee_policy.router, tags=["reference data"])
api_router.include_router(geography.router, tags=["reference data"])
api_router.include_router(reference.router, tags=["reference data"])
api_router.include_router(settings.router, tags=["reference data"])
api_router.include_router(content.router, tags=["content"])
api_router.include_router(jobs.router, tags=["jobs"])
api_router.include_router(partners.router, tags=["partners"])
api_router.include_router(campaigns.router, tags=["recruitment operations"])
api_router.include_router(targets.router, tags=["recruitment operations"])
api_router.include_router(scorecards.router, tags=["recruitment operations"])
api_router.include_router(reports.router, tags=["recruitment operations"])
api_router.include_router(candidates.router, tags=["candidate pipeline"])
