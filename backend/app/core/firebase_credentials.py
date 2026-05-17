from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.core.config import Settings


def load_service_account_info(settings: Settings) -> dict[str, Any] | None:
    if settings.firebase_service_account_json:
        return json.loads(settings.firebase_service_account_json)

    if settings.firebase_service_account_path:
        service_account_path = Path(settings.firebase_service_account_path)
        return json.loads(service_account_path.read_text(encoding="utf-8"))

    return None