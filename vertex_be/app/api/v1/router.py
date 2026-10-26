from fastapi import APIRouter

from app.api.v1 import content, fee_policy, geography, health, jobs, me, reference, settings

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(me.router, tags=["auth"])
api_router.include_router(fee_policy.router, tags=["reference data"])
api_router.include_router(geography.router, tags=["reference data"])
api_router.include_router(reference.router, tags=["reference data"])
api_router.include_router(settings.router, tags=["reference data"])
api_router.include_router(content.router, tags=["content"])
api_router.include_router(jobs.router, tags=["jobs"])
