from __future__ import annotations

from datetime import datetime, timezone
import base64
import json
from pathlib import Path
from typing import Any

from google.api_core.exceptions import AlreadyExists
from google.cloud.firestore_v1 import SERVER_TIMESTAMP
from google.cloud.firestore_v1.async_client import AsyncClient
from google.oauth2 import service_account

from app.core.config import Settings
from app.core.firebase_credentials import load_service_account_info


class FirestoreRepository:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        client_kwargs: dict[str, Any] = {}
        service_account_info = load_service_account_info(settings)
        if service_account_info is not None:
            client_kwargs["credentials"] = service_account.Credentials.from_service_account_info(service_account_info)
        self._client = AsyncClient(project=settings.firebase_project_id, **client_kwargs)
        self._prefix = settings.firestore_collection_prefix

    def _users_collection(self):
        return self._client.collection(f"{self._prefix}_users")

    def _telegram_challenges_collection(self):
        return self._client.collection(f"{self._prefix}_telegram_login_challenges")

    def _media_collection(self):
        return self._client.collection(f"{self._prefix}_media")

    def _telegram_session_doc(self, user_id: str):
        return self._users_collection().document(user_id).collection("integrations").document("telegram")

    def _telegram_profile_doc(self, user_id: str):
        return self._users_collection().document(user_id).collection("profiles").document("telegram")

    def _telegram_storage_doc(self, user_id: str):
        return self._users_collection().document(user_id).collection("integrations").document("telegram_storage")

    def _telegram_provisioning_lock_doc(self, user_id: str):
        return self._users_collection().document(user_id).collection("integrations").document("telegram_provisioning_lock")

    def _telegram_provisioning_doc(self, user_id: str):
        return self._users_collection().document(user_id).collection("integrations").document("telegram_provisioning")

    def _telegram_challenge_lock_doc(self, user_id: str, phone_number: str):
        # Use a filename-safe key for the phone number so lock docs are unique per phone
        key = base64.urlsafe_b64encode(phone_number.encode()).decode()
        return self._users_collection().document(user_id).collection("integrations").document(f"telegram_challenge_lock_{key}")

    def _user_doc(self, user_id: str):
        return self._users_collection().document(user_id)

    async def ensure_canonical_user(self, user_id: str, payload: dict[str, Any]) -> None:
        snapshot = await self._user_doc(user_id).get()
        existing = snapshot.to_dict() if snapshot.exists else {}

        existing_providers = existing.get("authProviders") or []
        next_providers = payload.get("authProviders") or []
        merged_providers = sorted({str(provider) for provider in [*existing_providers, *next_providers] if provider})

        data = {
            **existing,
            **payload,
            "authProviders": merged_providers,
            "updatedAt": SERVER_TIMESTAMP,
        }
        if snapshot.exists and existing.get("createdAt") is not None:
            data["createdAt"] = existing.get("createdAt")
        else:
            data["createdAt"] = SERVER_TIMESTAMP

        await self._user_doc(user_id).set(data, merge=True)

    async def upsert_user_profile(self, user_id: str, payload: dict[str, Any]) -> None:
        snapshot = await self._user_doc(user_id).get()
        existing = snapshot.to_dict() if snapshot.exists else {}

        data = {
            **existing,
            **payload,
            "updatedAt": SERVER_TIMESTAMP,
        }

        if snapshot.exists and existing.get("createdAt") is not None:
            data["createdAt"] = existing["createdAt"]
        else:
            data["createdAt"] = SERVER_TIMESTAMP

        await self._user_doc(user_id).set(data, merge=True)

    async def save_telegram_login_challenge(self, challenge_id: str, payload: dict[str, Any]) -> None:
        await self._telegram_challenges_collection().document(challenge_id).set(
            {
                **payload,
                "createdAt": SERVER_TIMESTAMP,
                "updatedAt": SERVER_TIMESTAMP,
            },
            merge=True,
        )

    async def get_telegram_login_challenge(self, challenge_id: str) -> dict[str, Any] | None:
        snapshot = await self._telegram_challenges_collection().document(challenge_id).get()
        if not snapshot.exists:
            return None
        return snapshot.to_dict()

    async def get_active_telegram_login_challenge(self, user_id: str, phone_number: str) -> tuple[str, dict[str, Any]] | None:
        now = datetime.now(timezone.utc)
        query = (
            self._telegram_challenges_collection()
            .where("userId", "==", user_id)
            .where("phoneNumber", "==", phone_number)
            .limit(10)
        )

        best_snapshot = None
        best_data: dict[str, Any] | None = None
        best_created_at = None

        async for snapshot in query.stream():
            data = snapshot.to_dict() or {}
            expires_at = data.get("expiresAt")
            if not (expires_at and hasattr(expires_at, "replace") and expires_at > now):
                continue

            created_at = data.get("createdAt") or data.get("updatedAt")
            if best_snapshot is None:
                best_snapshot = snapshot
                best_data = data
                best_created_at = created_at
                continue

            if created_at and hasattr(created_at, "replace") and (
                best_created_at is None or created_at > best_created_at
            ):
                best_snapshot = snapshot
                best_data = data
                best_created_at = created_at

        if best_snapshot and best_data:
            return best_snapshot.id, best_data

        return None

    async def delete_active_telegram_login_challenges(self, user_id: str, phone_number: str) -> None:
        query = (
            self._telegram_challenges_collection()
            .where("userId", "==", user_id)
            .where("phoneNumber", "==", phone_number)
            .limit(10)
        )

        async for snapshot in query.stream():
            data = snapshot.to_dict() or {}
            expires_at = data.get("expiresAt")
            if expires_at and hasattr(expires_at, "replace") and expires_at > datetime.now(timezone.utc):
                await snapshot.reference.delete()

    async def delete_telegram_login_challenge(self, challenge_id: str) -> None:
        await self._telegram_challenges_collection().document(challenge_id).delete()

    async def save_telegram_session(self, user_id: str, payload: dict[str, Any]) -> None:
        await self.save_telegram_storage(user_id, payload, create_new=payload.get("createdAt") is None)

    async def save_telegram_storage(self, user_id: str, payload: dict[str, Any], *, create_new: bool = False) -> None:
        data = {
            **payload,
            "updatedAt": SERVER_TIMESTAMP,
        }
        if create_new:
            data["createdAt"] = payload.get("createdAt", SERVER_TIMESTAMP)
        await self._telegram_storage_doc(user_id).set(data, merge=True)

    async def get_telegram_storage(self, user_id: str) -> dict[str, Any] | None:
        snapshot = await self._telegram_storage_doc(user_id).get()
        if not snapshot.exists:
            return None
        return snapshot.to_dict()

    async def delete_telegram_storage(self, user_id: str) -> None:
        await self._telegram_storage_doc(user_id).delete()

    async def mark_media_unavailable(self, media_id: str, *, reason: str | None = None) -> None:
        snapshot = await self._media_collection().document(media_id).get()
        if not snapshot.exists:
            return

        existing = snapshot.to_dict() or {}
        await self._media_collection().document(media_id).set(
            {
                **existing,
                "status": "unavailable",
                "availabilityReason": reason,
                "updatedAt": SERVER_TIMESTAMP,
            },
            merge=True,
        )

    async def invalidate_telegram_storage(self, user_id: str, *, reason: str | None = None) -> None:
        snapshot = await self._telegram_storage_doc(user_id).get()
        existing = snapshot.to_dict() if snapshot.exists else {}
        if not existing:
            return

        await self._telegram_storage_doc(user_id).set(
            {
                **existing,
                "encryptedSession": None,
                "status": "disconnected",
                "sessionValidationStatus": "invalid",
                "sessionInvalidReason": reason,
                "updatedAt": SERVER_TIMESTAMP,
            },
            merge=True,
        )

        await self.upsert_user_profile(
            user_id,
            {
                "telegramLinked": False,
                "telegramLinkStatus": "disconnected",
                "telegramLinkReason": reason,
            },
        )

    async def save_telegram_provisioning(self, user_id: str, payload: dict[str, Any]) -> None:
        snapshot = await self._telegram_provisioning_doc(user_id).get()
        existing = snapshot.to_dict() if snapshot.exists else {}

        data = {
            **existing,
            **payload,
            "updatedAt": SERVER_TIMESTAMP,
        }

        if snapshot.exists and existing.get("createdAt") is not None:
            data["createdAt"] = existing["createdAt"]
        else:
            data["createdAt"] = SERVER_TIMESTAMP

        await self._telegram_provisioning_doc(user_id).set(data, merge=True)

    async def get_telegram_provisioning(self, user_id: str) -> dict[str, Any] | None:
        snapshot = await self._telegram_provisioning_doc(user_id).get()
        if not snapshot.exists:
            return None
        return snapshot.to_dict()

    async def delete_telegram_provisioning(self, user_id: str) -> None:
        await self._telegram_provisioning_doc(user_id).delete()

    async def acquire_telegram_provisioning_lock(
        self,
        user_id: str,
        *,
        request_id: str,
        ttl_seconds: int = 60,
    ) -> bool:
        lock_doc = self._telegram_provisioning_lock_doc(user_id)
        now = datetime.now(timezone.utc)
        now_ts = now.timestamp()
        payload = {
            "requestId": request_id,
            "userId": user_id,
            "status": "locked",
            "createdAt": SERVER_TIMESTAMP,
            "updatedAt": SERVER_TIMESTAMP,
            "expiresAt": now_ts + ttl_seconds,
        }

        try:
            await lock_doc.create(payload)
            return True
        except AlreadyExists:
            snapshot = await lock_doc.get()
            existing = snapshot.to_dict() if snapshot.exists else None
            if existing and float(existing.get("expiresAt") or 0) < now_ts:
                await lock_doc.delete()
                try:
                    await lock_doc.create(payload)
                    return True
                except AlreadyExists:
                    return False
            return False

    async def acquire_telegram_challenge_lock(self, user_id: str, phone_number: str, *, request_id: str, ttl_seconds: int = 30) -> bool:
        lock_doc = self._telegram_challenge_lock_doc(user_id, phone_number)
        now = datetime.now(timezone.utc)
        now_ts = now.timestamp()
        payload = {
            "requestId": request_id,
            "userId": user_id,
            "phoneNumber": phone_number,
            "status": "locked",
            "createdAt": SERVER_TIMESTAMP,
            "updatedAt": SERVER_TIMESTAMP,
            "expiresAt": now_ts + ttl_seconds,
        }

        try:
            await lock_doc.create(payload)
            return True
        except AlreadyExists:
            snapshot = await lock_doc.get()
            existing = snapshot.to_dict() if snapshot.exists else None
            if existing and float(existing.get("expiresAt") or 0) < now_ts:
                await lock_doc.delete()
                try:
                    await lock_doc.create(payload)
                    return True
                except AlreadyExists:
                    return False
            return False

    async def release_telegram_challenge_lock(self, user_id: str, phone_number: str, *, request_id: str) -> None:
        lock_doc = self._telegram_challenge_lock_doc(user_id, phone_number)
        snapshot = await lock_doc.get()
        if not snapshot.exists:
            return
        existing = snapshot.to_dict() or {}
        if existing.get("requestId") == request_id:
            await lock_doc.delete()

    async def cleanup_expired_telegram_login_challenges(self) -> int:
        """Delete expired telegram login challenge documents and return count deleted."""
        now = datetime.now(timezone.utc)
        deleted = 0
        async for snapshot in self._telegram_challenges_collection().stream():
            data = snapshot.to_dict() or {}
            expires_at = data.get("expiresAt")
            if expires_at and hasattr(expires_at, "replace") and expires_at < now:
                await snapshot.reference.delete()
                deleted += 1
        return deleted

    async def renew_telegram_provisioning_lock(
        self,
        user_id: str,
        *,
        request_id: str,
        ttl_seconds: int = 60,
    ) -> bool:
        lock_doc = self._telegram_provisioning_lock_doc(user_id)
        now = datetime.now(timezone.utc)
        now_ts = now.timestamp()

        snapshot = await lock_doc.get()
        if not snapshot.exists:
            return False

        existing = snapshot.to_dict() or {}
        if existing.get("requestId") != request_id:
            return False

        # Only renew while the lock is still ours and has not drifted too far past expiry.
        if float(existing.get("expiresAt") or 0) < now_ts - 5:
            return False

        await lock_doc.set(
            {
                "requestId": request_id,
                "userId": user_id,
                "status": "locked",
                "expiresAt": now_ts + ttl_seconds,
                "updatedAt": SERVER_TIMESTAMP,
            },
            merge=True,
        )
        return True

    async def release_telegram_provisioning_lock(self, user_id: str) -> None:
        await self._telegram_provisioning_lock_doc(user_id).delete()

    async def get_telegram_provisioning_lock(self, user_id: str) -> dict[str, Any] | None:
        snapshot = await self._telegram_provisioning_lock_doc(user_id).get()
        if not snapshot.exists:
            return None
        return snapshot.to_dict()

    async def wait_for_telegram_storage(self, user_id: str, *, timeout_seconds: int = 15, poll_interval_seconds: float = 0.4) -> dict[str, Any] | None:
        deadline = datetime.now(timezone.utc).timestamp() + timeout_seconds
        while datetime.now(timezone.utc).timestamp() < deadline:
            storage = await self.get_telegram_storage(user_id)
            if storage:
                return storage
            await self._sleep(poll_interval_seconds)
        return None

    async def wait_for_telegram_provisioning(self, user_id: str, *, timeout_seconds: int = 15, poll_interval_seconds: float = 0.4) -> dict[str, Any] | None:
        deadline = datetime.now(timezone.utc).timestamp() + timeout_seconds
        while datetime.now(timezone.utc).timestamp() < deadline:
            provisioning = await self.get_telegram_provisioning(user_id)
            if provisioning:
                return provisioning
            await self._sleep(poll_interval_seconds)
        return None

    async def _sleep(self, seconds: float) -> None:
        import asyncio

        await asyncio.sleep(seconds)

    async def get_telegram_session(self, user_id: str) -> dict[str, Any] | None:
        return await self.get_telegram_storage(user_id)

    async def save_telegram_profile(self, user_id: str, payload: dict[str, Any]) -> None:
        await self._telegram_profile_doc(user_id).set(
            {
                **payload,
                "updatedAt": SERVER_TIMESTAMP,
                "createdAt": payload.get("createdAt", SERVER_TIMESTAMP),
            },
            merge=True,
        )

    async def get_telegram_profile(self, user_id: str) -> dict[str, Any] | None:
        snapshot = await self._telegram_profile_doc(user_id).get()
        if not snapshot.exists:
            return None
        return snapshot.to_dict()

    async def save_media_item(self, media_id: str, payload: dict[str, Any]) -> None:
        await self._media_collection().document(media_id).set(
            {
                **payload,
                "updatedAt": SERVER_TIMESTAMP,
                "createdAt": payload.get("createdAt", SERVER_TIMESTAMP),
            },
            merge=True,
        )

    def _serialize_media_item(self, item: dict[str, Any]) -> dict[str, Any]:
        serialized = dict(item)
        for key in ("createdAt", "updatedAt"):
            value = serialized.get(key)
            if hasattr(value, "isoformat"):
                serialized[key] = value.isoformat()
        return serialized

    async def get_media_item(self, media_id: str) -> dict[str, Any] | None:
        snapshot = await self._media_collection().document(media_id).get()
        if not snapshot.exists:
            return None
        return self._serialize_media_item(snapshot.to_dict() or {})

    def encode_media_cursor(self, created_at: Any, media_id: str) -> str:
        payload = {
            "createdAt": created_at.isoformat() if hasattr(created_at, "isoformat") else str(created_at),
            "mediaId": media_id,
        }
        raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        return base64.urlsafe_b64encode(raw).decode("utf-8")

    def decode_media_cursor(self, cursor: str) -> dict[str, Any]:
        raw = base64.urlsafe_b64decode(cursor.encode("utf-8"))
        payload = json.loads(raw.decode("utf-8"))
        if not isinstance(payload, dict) or "createdAt" not in payload or "mediaId" not in payload:
            raise ValueError("Invalid media cursor.")
        created_at_raw = str(payload["createdAt"])
        if created_at_raw.endswith("Z"):
            created_at_raw = created_at_raw[:-1] + "+00:00"
        created_at = datetime.fromisoformat(created_at_raw)
        return {"createdAt": created_at, "mediaId": str(payload["mediaId"]) }

    async def list_media_items(
        self,
        user_id: str,
        limit: int = 50,
        *,
        cursor: dict[str, Any] | None = None,
        media_kind: str | None = None,
    ) -> tuple[list[dict[str, Any]], str | None]:
        query = self._media_collection().where("userId", "==", user_id)
        snapshots = query.stream()
        items: list[dict[str, Any]] = []
        async for snapshot in snapshots:
            data = snapshot.to_dict()
            if not data:
                continue

            if media_kind and media_kind != "all" and data.get("mediaKind") != media_kind:
                continue

            items.append(data)

        def sort_key(item: dict[str, Any]) -> tuple[Any, str]:
            created_at = item.get("createdAt")
            if hasattr(created_at, "replace"):
                created_sort = created_at
            else:
                created_sort = datetime.min.replace(tzinfo=timezone.utc)
            return created_sort, str(item.get("mediaId") or "")

        items.sort(key=sort_key, reverse=True)

        if cursor:
            cursor_index = None
            for index, item in enumerate(items):
                if item.get("mediaId") == cursor.get("mediaId") and item.get("createdAt") == cursor.get("createdAt"):
                    cursor_index = index
                    break

            if cursor_index is not None:
                items = items[cursor_index + 1 :]

        next_cursor: str | None = None
        if len(items) > limit:
            last_item = items[limit - 1]
            next_cursor = self.encode_media_cursor(last_item.get("createdAt"), last_item.get("mediaId", ""))
            items = items[:limit]

        return [self._serialize_media_item(item) for item in items], next_cursor

    async def get_now_utc(self) -> datetime:
        return datetime.now(timezone.utc)
