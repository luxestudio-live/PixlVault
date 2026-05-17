from functools import lru_cache
from pathlib import Path

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = Field(default="PixlVault API", alias="APP_NAME")
    app_env: str = Field(default="development", alias="APP_ENV")
    api_v1_prefix: str = Field(default="/api/v1", alias="API_V1_PREFIX")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000"], alias="CORS_ORIGINS")

    firebase_project_id: str | None = Field(default=None, alias="FIREBASE_PROJECT_ID")
    firebase_service_account_path: str | None = Field(default=None, alias="FIREBASE_SERVICE_ACCOUNT_PATH")
    firebase_service_account_json: str | None = Field(default=None, alias="FIREBASE_SERVICE_ACCOUNT_JSON")

    telegram_api_id: int = Field(alias="TELEGRAM_API_ID")
    telegram_api_hash: str = Field(alias="TELEGRAM_API_HASH")
    telegram_session_encryption_key: str = Field(alias="TELEGRAM_SESSION_ENCRYPTION_KEY")
    media_stream_token_ttl_seconds: int = Field(default=300, alias="MEDIA_STREAM_TOKEN_TTL_SECONDS")

    firestore_collection_prefix: str = Field(default="pixlvault", alias="FIRESTORE_COLLECTION_PREFIX")
    upload_temp_dir: str = Field(default="/tmp/pixlvault", alias="UPLOAD_TEMP_DIR")
    maintenance_auth_token: str | None = Field(default=None, alias="MAINTENANCE_AUTH_TOKEN")

    @model_validator(mode="after")
    def validate_deployment_settings(self) -> "Settings":
        environment = self.app_env.lower()

        if self.firebase_service_account_path and self.firebase_service_account_json:
            raise ValueError("Set only one of FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON.")

        if environment not in {"development", "local", "test"}:
            if not self.cors_origins:
                raise ValueError("CORS_ORIGINS must include at least one frontend origin in production.")

            local_origins = [origin for origin in self.cors_origins if "localhost" in origin or "127.0.0.1" in origin]
            if local_origins:
                raise ValueError("CORS_ORIGINS cannot include localhost or 127.0.0.1 origins in production.")

            if not self.firebase_service_account_path and not self.firebase_service_account_json:
                raise ValueError("Set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON for production deployments.")

        upload_temp_path = Path(self.upload_temp_dir)
        if not upload_temp_path.is_absolute():
            raise ValueError("UPLOAD_TEMP_DIR must be an absolute path.")

        if self.media_stream_token_ttl_seconds <= 0:
            raise ValueError("MEDIA_STREAM_TOKEN_TTL_SECONDS must be greater than zero.")

        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
