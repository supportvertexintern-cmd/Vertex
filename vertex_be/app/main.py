from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core import api, audit  # noqa: F401  (audit registers the trail's flush hooks)
from app.core.access import default_deny
from app.core.config import settings
from app.core.logging import RequestContextMiddleware, configure_logging
from app.core.security_headers import SecurityHeadersMiddleware


def create_app() -> FastAPI:
    configure_logging(settings.APP_ENV)
    # Schema is managed by Alembic (`alembic upgrade head`), never create_all.
    app = FastAPI(
        title=settings.PROJECT_NAME,
        version=settings.VERSION,
        debug=settings.DEBUG,
        openapi_url=f"{settings.API_V1_PREFIX}/openapi.json",
        docs_url="/docs",
        redoc_url="/redoc",
        # Default deny (app/core/access.py): runs before every route.
        dependencies=[Depends(default_deny)],
    )
    # Innermost: the error shape for every response (app/core/api.py).
    api.install(app)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Request-ID"],
    )
    # Outermost, so every response (CORS rejections included) carries the
    # request ID and gets an access line.
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestContextMiddleware)
    app.include_router(api_router, prefix=settings.API_V1_PREFIX)

    @app.get("/", include_in_schema=False)
    def root() -> dict[str, str]:
        return {
            "name": settings.PROJECT_NAME,
            "version": settings.VERSION,
            "docs": "/docs",
            "health": f"{settings.API_V1_PREFIX}/health",
        }

    return app


app = create_app()
