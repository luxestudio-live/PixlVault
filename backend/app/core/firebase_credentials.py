from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.core.config import Settings


def _normalize_service_account_info(service_account_info: dict[str, Any]) -> dict[str, Any]:
    normalized_info = dict(service_account_info)
    private_key = normalized_info.get("private_key")
    if isinstance(private_key, str):
        normalized_info["private_key"] = (
            private_key.replace("\\r\\n", "\n")
            .replace("\\n", "\n")
            .replace("\r\n", "\n")
            .replace("\r", "\n")
            .strip()
        )
    return normalized_info


def load_service_account_info(settings: Settings) -> dict[str, Any] | None:
    if settings.firebase_service_account_path:
        service_account_path = Path(settings.firebase_service_account_path)
        raw_json = service_account_path.read_text(encoding="utf-8")
        return _normalize_service_account_info(json.loads(raw_json))

    return None