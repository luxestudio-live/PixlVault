from functools import lru_cache
import json
import os
from pathlib import Path

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_DIR = Path(__file__).resolve().parents[2]


def _load_local_env_file() -> None:
    app_env = os.environ.get("APP_ENV", "").strip().lower()
    if app_env == "production":
        return

    env_file = BACKEND_DIR / ".env"
    if not env_file.exists():
        return

    try:
        for raw_line in env_file.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue

            key, value = line.split("=", 1)
            key = key.strip()
            if not key or key in os.environ:
                continue

            os.environ[key] = value.strip().strip('"').strip("'")
    except OSError:
        return


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    app_name: str = Field(default="PixlVault API", alias="APP_NAME")
    app_env: str = Field(default="development", alias="APP_ENV")
    api_v1_prefix: str = Field(default="/api/v1", alias="API_V1_PREFIX")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000"], alias="CORS_ORIGINS")

    firebase_project_id: str | None = Field(default=None, alias="FIREBASE_PROJECT_ID")
    firebase_service_account_path: str | None = Field(default=None, alias="FIREBASE_SERVICE_ACCOUNT_PATH")

    telegram_api_id: int = Field(alias="TELEGRAM_API_ID")
    telegram_api_hash: str = Field(alias="TELEGRAM_API_HASH")
    telegram_session_encryption_key: str = Field(alias="TELEGRAM_SESSION_ENCRYPTION_KEY")
    media_stream_token_ttl_seconds: int = Field(default=300, alias="MEDIA_STREAM_TOKEN_TTL_SECONDS")

    firestore_collection_prefix: str = Field(default="pixlvault", alias="FIRESTORE_COLLECTION_PREFIX")
    upload_temp_dir: str = Field(default="/tmp/pixlvault", alias="UPLOAD_TEMP_DIR")
    maintenance_auth_token: str | None = Field(default=None, alias="MAINTENANCE_AUTH_TOKEN")

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value):
        if value is None:
            return value

        if isinstance(value, str):
            text = value.strip()
            if not text:
                return []

            if text.startswith("["):
                try:
                    parsed = json.loads(text)
                    if isinstance(parsed, list):
                        return parsed
                except json.JSONDecodeError:
                    # Accept legacy bracketed lists like ['https://a.com'].
                    inner = text.strip("[]")
                    cleaned = [
                        origin.strip().strip('"').strip("'")
                        for origin in inner.split(",")
                        if origin.strip().strip('"').strip("'")
                    ]
                    if cleaned:
                        return cleaned

            return [origin.strip() for origin in text.split(",") if origin.strip()]

        return value

    @model_validator(mode="after")
    def validate_deployment_settings(self) -> "Settings":
        environment = self.app_env.lower()

        if environment not in {"development", "local", "test"}:
            if not self.cors_origins:
                raise ValueError("CORS_ORIGINS must include at least one frontend origin in production.")

            local_origins = [origin for origin in self.cors_origins if "localhost" in origin or "127.0.0.1" in origin]
            if local_origins:
                raise ValueError("CORS_ORIGINS cannot include localhost or 127.0.0.1 origins in production.")

            if not self.firebase_service_account_path:
                raise ValueError("Set FIREBASE_SERVICE_ACCOUNT_PATH for production deployments.")

        upload_temp_path = Path(self.upload_temp_dir)
        if not (upload_temp_path.is_absolute() or self.upload_temp_dir.startswith("/")):
            raise ValueError("UPLOAD_TEMP_DIR must be an absolute path.")

        if self.media_stream_token_ttl_seconds <= 0:
            raise ValueError("MEDIA_STREAM_TOKEN_TTL_SECONDS must be greater than zero.")

        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    _load_local_env_file()

    # Normalize environment CORS_ORIGINS to a JSON array string so pydantic's
    # EnvSettingsSource can decode it deterministically in all environments.
    try:
        raw = os.environ.get("CORS_ORIGINS")
        if raw is not None:
            s = raw.lstrip("\ufeff").strip()
            if s == "":
                os.environ["CORS_ORIGINS"] = "[]"
            elif s.startswith("["):
                # Keep valid JSON arrays. If malformed (for example with single
                # quotes), normalize to a proper JSON array string.
                try:
                    parsed = json.loads(s)
                    if isinstance(parsed, list):
                        os.environ["CORS_ORIGINS"] = json.dumps(parsed)
                    else:
                        os.environ["CORS_ORIGINS"] = "[]"
                except json.JSONDecodeError:
                    inner = s.strip("[]")
                    parts = [
                        p.strip().strip('"').strip("'")
                        for p in inner.split(",")
                        if p.strip().strip('"').strip("'")
                    ]
                    os.environ["CORS_ORIGINS"] = json.dumps(parts)
            elif s.startswith("{"):
                # Not expected for CORS list; force an empty JSON array so
                # Settings validation emits a clear production error.
                os.environ["CORS_ORIGINS"] = "[]"
            else:
                parts = [p.strip() for p in s.split(",") if p.strip()]
                os.environ["CORS_ORIGINS"] = json.dumps(parts)
    except Exception:
        # Be defensive: if normalization fails, leave env as-is and let
        # Settings() raise a clear error which will be logged by EB.
        pass

    return Settings()
