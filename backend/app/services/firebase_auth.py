import asyncio

import firebase_admin
from firebase_admin import auth, credentials

from app.core.config import Settings
from app.core.firebase_credentials import load_service_account_info


class FirebaseAuthService:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._ensure_initialized()

    def _ensure_initialized(self) -> None:
        if firebase_admin._apps:
            return

        service_account_info = load_service_account_info(self._settings)
        if service_account_info is not None:
            cred = credentials.Certificate(service_account_info)
            init_kwargs = {}
            if self._settings.firebase_project_id:
                init_kwargs["projectId"] = self._settings.firebase_project_id
            firebase_admin.initialize_app(cred, init_kwargs)
            return

        firebase_admin.initialize_app()

    async def verify_id_token(self, id_token: str) -> dict:
        return await asyncio.to_thread(auth.verify_id_token, id_token, None, True)
