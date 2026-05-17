from __future__ import annotations

import contextvars
import json
import logging
import time
import uuid
from typing import Any

request_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar("request_id", default=None)
current_uid_var: contextvars.ContextVar[str | None] = contextvars.ContextVar("current_uid", default=None)


def set_request_context(*, request_id: str | None = None, uid: str | None = None) -> tuple[contextvars.Token[Any] | None, contextvars.Token[Any] | None]:
    request_token = request_id_var.set(request_id) if request_id is not None else None
    uid_token = current_uid_var.set(uid) if uid is not None else None
    return request_token, uid_token


def reset_request_context(tokens: tuple[contextvars.Token[Any] | None, contextvars.Token[Any] | None]) -> None:
    request_token, uid_token = tokens
    if request_token is not None:
        request_id_var.reset(request_token)
    if uid_token is not None:
        current_uid_var.reset(uid_token)


def get_request_id() -> str | None:
    return request_id_var.get()


def get_current_uid() -> str | None:
    return current_uid_var.get()


def generate_request_id() -> str:
    return uuid.uuid4().hex


class JsonLogFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime(record.created)),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": getattr(record, "request_id", get_request_id()),
            "uid": getattr(record, "uid", get_current_uid()),
        }

        for field in (
            "event",
            "route",
            "method",
            "status",
            "duration_ms",
            "media_id",
            "media_kind",
            "cache_status",
            "range_start",
            "range_end",
            "range_header",
            "telegram_status",
            "retryable",
            "error_code",
            "operation",
            "channel_id",
            "message_id",
            "thumbnail_message_id",
            "query_ms",
            "size_bytes",
            "stream_ms",
            "upload_ms",
            "thumbnail_ms",
            "flood_wait_seconds",
            "retry_count",
        ):
            value = getattr(record, field, None)
            if value is not None:
                payload[field] = value

        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)

        return json.dumps(payload, default=str, separators=(",", ":"))


def log_event(logger: logging.Logger, level: int, event: str, message: str, **fields: Any) -> None:
    logger.log(level, message, extra={"event": event, **fields})