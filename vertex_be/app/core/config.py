from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parents[2]


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

    SECRET_KEY: str = "change-me-in-production"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 14

    CORS_ORIGINS: list[str] = ["http://localhost:3000", "http://localhost:8080"]

    # Private document storage (SRS FR-1.6) — local disk for now; Document.
    # storage_path is always relative to this root, never a public URL.
    UPLOAD_DIR: Path = BASE_DIR / "uploads"
    MAX_UPLOAD_SIZE: int = 10 * 1024 * 1024

    @model_validator(mode="after")
    def _deployed_envs_are_locked_down(self) -> "Settings":
        if self.APP_ENV != "development":
            if self.DEBUG:
                raise ValueError(f"DEBUG must be false in {self.APP_ENV}")
            if self.SECRET_KEY == "change-me-in-production" or len(self.SECRET_KEY) < 32:
                raise ValueError(f"SECRET_KEY must be a real 32+ char secret in {self.APP_ENV}")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
