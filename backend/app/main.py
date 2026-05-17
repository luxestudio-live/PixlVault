from __future__ import annotations

from contextlib import asynccontextmanager
import logging
import time
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1.router import api_router
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.core.observability import generate_request_id, log_event, reset_request_context, set_request_context
from app.dependencies import CurrentUser, get_current_user
from app.services.encryption import SessionCryptographer
from app.services.firebase_auth import FirebaseAuthService
from app.services.firestore import FirestoreRepository
from app.services.media import MediaService
from app.services.telegram_linking import TelegramLinkingService
from app.services.telegram_client import TelegramService
from app.services.thumbnail import ThumbnailService
from app.utils.errors import PixlVaultError, TelegramFloodWaitError


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    configure_logging(settings.log_level)

    Path(settings.upload_temp_dir).mkdir(parents=True, exist_ok=True)

    cryptographer = SessionCryptographer(settings.telegram_session_encryption_key)
    firestore = FirestoreRepository(settings)
    firebase_auth = FirebaseAuthService(settings)
    telegram = TelegramService(settings, cryptographer)
    telegram_linking = TelegramLinkingService(firestore, telegram)
    thumbnails = ThumbnailService()
    media_service = MediaService(settings, firestore, telegram, thumbnails, cryptographer)

    app.state.settings = settings
    app.state.firestore = firestore
    app.state.firebase_auth = firebase_auth
    app.state.telegram = telegram
    app.state.telegram_linking = telegram_linking
    app.state.media_service = media_service
    app.state.thumbnail_service = thumbnails
    app.state.cryptographer = cryptographer
    app.state.services = {
        "firestore": firestore,
        "firebase_auth": firebase_auth,
        "telegram": telegram,
        "telegram_linking": telegram_linking,
        "media": media_service,
        "thumbnails": thumbnails,
        "cryptographer": cryptographer,
    }

    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.app_name, lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(api_router, prefix=settings.api_v1_prefix)

    @app.middleware("http")
    async def request_observability(request: Request, call_next):
        request_id = request.headers.get("x-request-id") or generate_request_id()
        request.state.request_id = request_id
        tokens = set_request_context(request_id=request_id)
        start_time = time.perf_counter()

        try:
            response = await call_next(request)
        except Exception:
            duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
            log_event(
                logging.getLogger("app.request"),
                logging.ERROR,
                "request_error",
                "Unhandled request error",
                request_id=request_id,
                route=str(request.url.path),
                method=request.method,
                duration_ms=duration_ms,
            )
            reset_request_context(tokens)
            raise

        duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
        response.headers["x-request-id"] = request_id
        log_event(
            logging.getLogger("app.request"),
            logging.INFO,
            "request_completed",
            "Request completed",
            request_id=request_id,
            route=str(request.url.path),
            method=request.method,
            status=response.status_code,
            duration_ms=duration_ms,
        )
        reset_request_context(tokens)
        return response

    @app.exception_handler(PixlVaultError)
    async def pixlvault_error_handler(request: Request, exc: PixlVaultError):
        payload = {"error": exc.code, "message": exc.message}
        headers = {}
        if isinstance(exc, TelegramFloodWaitError):
            headers["Retry-After"] = str(exc.retry_after_seconds)
            payload["retry_after_seconds"] = exc.retry_after_seconds
        log_event(
            logging.getLogger("app.error"),
            logging.WARNING,
            "pixlvault_error",
            "Handled application error",
            request_id=getattr(request.state, "request_id", None),
            route=str(request.url.path),
            method=request.method,
            status=exc.status_code,
            error_code=exc.code,
            retryable=getattr(exc, "retryable", False),
        )
        return JSONResponse(status_code=exc.status_code, content=payload, headers=headers)

    @app.get("/")
    async def root() -> dict[str, str]:
        return {"service": settings.app_name, "environment": settings.app_env}

    @app.get("/debug/current-user")
    async def debug_current_user(current_user: CurrentUser = Depends(get_current_user)) -> dict[str, str | None]:
        if settings.app_env.lower() not in {"development", "local", "test"}:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

        return {
            "uid": current_user.uid,
            "email": current_user.email,
            "name": current_user.name,
        }

    return app


app = create_app()
