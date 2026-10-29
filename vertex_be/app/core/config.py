from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parents[2]

# The driver installed (requirements.txt: psycopg2-binary). A bare
# postgresql:// URL means whatever SQLAlchemy's default is, and SQLAlchemy
# 2.1 changed that default to psycopg (v3).
DB_DRIVER = "postgresql+psycopg2://"


def with_driver(url: str) -> str:
    """postgresql://... (the form Prisma and psql share) -> postgresql+psycopg2://...;
    a URL that already names a driver is left alone."""
    for bare in ("postgresql://", "postgres://"):
        if url.startswith(bare):
            return DB_DRIVER + url[len(bare):]
    return url


class Settings(BaseSettings):
    """Process environment wins over .env, so running outside Docker only
    needs DATABASE_URL pointed at localhost instead of the `db` service."""

    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        extra="ignore",
        case_sensitive=True,
    )

    PROJECT_NAME: str = "Vertex International Recruitment API"
    VERSION: str = "1.0.0"
    APP_ENV: Literal["development", "staging", "production"] = "development"
    DEBUG: bool = False
    API_V1_PREFIX: str = "/api/v1"

    DATABASE_URL: str
    # Alembic connects as the schema-owning role; the app's runtime role
    # (DATABASE_URL) can't run DDL. Unset (tests, local runs) = DATABASE_URL.
    MIGRATION_DATABASE_URL: str | None = None

    SECRET_KEY: str = "change-me-in-production"
    # The Next.js app's JWT_SECRET: FastAPI verifies the sessions it issues
    # (app/core/tokens.py). Unset in development = no token verifies.
    JWT_SECRET: str | None = None
    # Next.js's credential when it calls FastAPI (G18). Separate from
    # JWT_SECRET; _PREVIOUS is still accepted during a rotation. Unset in
    # development = no service token verifies.
    SERVICE_AUTH_SECRET: str | None = None
    SERVICE_AUTH_SECRET_PREVIOUS: str | None = None
    # Stripe, for each job payment stage's Product and Price (step 3.2,
    # app/services/stripe_pricing.py). Unset = pricing isn't synced: a job
    # still saves, and a manual sync answers 503.
    STRIPE_SECRET_KEY: str | None = None
    # The Stripe webhook's signing secret (payments step 7.2): the website
    # passes Stripe's request on as it came and FastAPI checks the signature
    # itself. Unset = the webhook answers 503 and Stripe retries.
    STRIPE_WEBHOOK_SECRET: str | None = None
    # PayPal (payments step 7.2: FastAPI creates and captures the
    # application-fee orders). The same variables as the web app's had.
    # Unset = PayPal answers 503.
    PAYPAL_CLIENT_ID: str | None = None
    PAYPAL_CLIENT_SECRET: str | None = None
    PAYPAL_API_BASE: str | None = None
    # The candidate pipeline handover (docs/architecture/pipeline-handover.md):
    # on since the switch (step 6.7), FastAPI writes the pipeline. The roll-
    # back: turn it off and restore vertex_web's grants (pipeline-handover.md
    # §6); every pipeline write then answers 503.
    PIPELINE_WRITES_ENABLED: bool = True
    # Document storage, as the web app's (vertex/src/lib/upload.ts, the same
    # variables): S3-compatible, so MinIO (S3_ENDPOINT, the local and
    # self-hosted stacks), AWS S3 (S3_REGION, no endpoint) or R2 (the
    # legacy R2_* names). Unset = uploads answer 503.
    S3_ENDPOINT: str | None = None
    S3_REGION: str | None = None
    S3_BUCKET: str | None = None
    S3_ACCESS_KEY_ID: str | None = None
    S3_SECRET_ACCESS_KEY: str | None = None
    R2_ENDPOINT: str | None = None
    R2_ACCOUNT_ID: str | None = None
    R2_BUCKET_NAME: str | None = None
    R2_ACCESS_KEY_ID: str | None = None
    R2_SECRET_ACCESS_KEY: str | None = None
    MAX_FILE_SIZE_MB: int = 5
    # Malware scanning with ClamAV's clamd (app/services/malware_scan.py).
    # Unset or unreachable = fail open: stored as "unscanned", scanned when
    # next opened (the owner's policy).
    CLAMD_HOST: str | None = None
    CLAMD_PORT: int = 3310
    CLAMD_TIMEOUT_MS: int = 30_000
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 14

    CORS_ORIGINS: list[str] = ["http://localhost:3000", "http://localhost:8080"]

    # Private document storage (SRS FR-1.6) — local disk for now; Document.
    # storage_path is always relative to this root, never a public URL.
    UPLOAD_DIR: Path = BASE_DIR / "uploads"
    MAX_UPLOAD_SIZE: int = 10 * 1024 * 1024

    @field_validator("DATABASE_URL", "MIGRATION_DATABASE_URL")
    @classmethod
    def _name_the_driver(cls, url: str | None) -> str | None:
        return with_driver(url) if url else url

    @field_validator("MAX_FILE_SIZE_MB", mode="before")
    @classmethod
    def _blank_size_is_the_default(cls, value: object) -> object:
        # Compose passes an unset variable as "": the default, as upload.ts
        # reads it (Number(x) || 5).
        return 5 if value in ("", None, "0", 0) else value

    @model_validator(mode="after")
    def _deployed_envs_are_locked_down(self) -> "Settings":
        if self.APP_ENV != "development":
            if self.DEBUG:
                raise ValueError(f"DEBUG must be false in {self.APP_ENV}")
            if self.SECRET_KEY == "change-me-in-production" or len(self.SECRET_KEY) < 32:
                raise ValueError(f"SECRET_KEY must be a real 32+ char secret in {self.APP_ENV}")
            if not self.JWT_SECRET or len(self.JWT_SECRET) < 32:
                raise ValueError(f"JWT_SECRET must be the web app's 32+ char secret in {self.APP_ENV}")
            if not self.SERVICE_AUTH_SECRET or len(self.SERVICE_AUTH_SECRET) < 32:
                raise ValueError(f"SERVICE_AUTH_SECRET must be a 32+ char secret in {self.APP_ENV}")
            if self.SERVICE_AUTH_SECRET == self.JWT_SECRET:
                raise ValueError("SERVICE_AUTH_SECRET must differ from JWT_SECRET")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
