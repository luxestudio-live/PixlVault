from __future__ import annotations

import asyncio
import secrets
import logging
from dataclasses import dataclass

from app.dependencies import CurrentUser
from app.services.firestore import FirestoreRepository
from app.services.telegram_client import TelegramChannelInfo, TelegramService

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class TelegramLinkResult:
    linked: bool
    channel_id: int
    telegram_user_id: int
    username: str | None
    created_channel: bool


class TelegramLinkingService:
    LOCK_TTL_SECONDS = 60
    LOCK_HEARTBEAT_SECONDS = 20

    def __init__(self, firestore: FirestoreRepository, telegram: TelegramService) -> None:
        self._firestore = firestore
        self._telegram = telegram

    def _default_channel_title(self, current_user: CurrentUser, verified: dict) -> str:
        preferred = (verified.get("channel_name") or "").strip()
        if preferred:
            return preferred[:80]

        return "PixlVault"

    def _channel_marker(self, verified: dict, existing_storage: dict | None = None) -> str:
        marker = (existing_storage or {}).get("channelMarker")
        if marker:
            return str(marker)

        about = (existing_storage or {}).get("channelAbout") or verified.get("channelAbout") or ""
        if "marker=" in about:
            extracted = about.split("marker=", 1)[1].split()[0].strip()
            if extracted:
                return extracted

        return secrets.token_urlsafe(12)

    async def complete_link(
        self,
        current_user: CurrentUser,
        verified: dict,
    ) -> TelegramLinkResult:
        logger = logging.getLogger(__name__)
        existing_storage = await self._firestore.get_telegram_storage(current_user.uid)
        if existing_storage and existing_storage.get("channelId") and existing_storage.get("channelAccessHash"):
            marker = self._channel_marker(verified, existing_storage)
            title = existing_storage.get("channelTitle") or self._default_channel_title(current_user, verified)
            about = existing_storage.get("channelAbout") or f"Private user-owned media channel for PixlVault. uid={current_user.uid} marker={marker}"
            logger.info("Validating Telegram storage channel for user %s", current_user.uid, extra={"event": "telegram_storage_channel_validate", "telegram_status": "validate", "channel_id": existing_storage.get("channelId")})
            channel_info, recreated, stale_reference = await self._telegram.ensure_storage_channel(
                verified["session_string"],
                channel_id=existing_storage.get("channelId"),
                access_hash=existing_storage.get("channelAccessHash"),
                title=title,
                about=about,
                marker=marker,
            )
            created_channel = recreated
            if recreated or stale_reference:
                logger.info(
                    "Telegram storage channel recovered for user %s (recreated=%s stale_reference=%s channel_id=%s)",
                    current_user.uid,
                    recreated,
                    stale_reference,
                    channel_info.channel_id,
                    extra={"event": "telegram_storage_channel_recovered", "telegram_status": "recovered"},
                )
                storage_payload = {
                    "encryptedSession": self._telegram.encrypt_session(verified["session_string"]),
                    "telegramUserId": verified["telegram_user_id"],
                    "telegramPhone": verified.get("phone"),
                    "telegramUsername": verified.get("username"),
                    "channelId": channel_info.channel_id,
                    "channelAccessHash": channel_info.access_hash,
                    "channelTitle": channel_info.title,
                    "channelAbout": channel_info.about,
                    "channelMarker": marker,
                    "status": "linked",
                    "channelValidationStatus": "recovered",
                }
                await self._firestore.save_telegram_storage(current_user.uid, storage_payload, create_new=False)
            else:
                logger.info("Reusing existing Telegram channel for user %s", current_user.uid, extra={"event": "telegram_provisioning_reuse", "telegram_status": "reuse", "channel_id": existing_storage.get("channelId")})
        else:
            logger.info("Provisioning new Telegram channel for user %s", current_user.uid, extra={"event": "telegram_provisioning_create", "telegram_status": "create"})
            channel_info, created_channel = await self._provision_channel_under_lock(current_user.uid, verified)

        assert channel_info is not None

        if existing_storage and not created_channel:
            storage_payload = {
                "encryptedSession": self._telegram.encrypt_session(verified["session_string"]),
                "telegramUserId": verified["telegram_user_id"],
                "telegramPhone": verified.get("phone"),
                "telegramUsername": verified.get("username"),
                "channelId": channel_info.channel_id,
                "channelAccessHash": channel_info.access_hash,
                "channelTitle": channel_info.title,
                "channelAbout": channel_info.about,
                "channelMarker": self._channel_marker(verified, existing_storage),
                "status": "linked",
            }
            await self._firestore.save_telegram_storage(current_user.uid, storage_payload, create_new=False)

        await self._firestore.upsert_user_profile(
            current_user.uid,
            {
                "displayName": current_user.name,
                "email": current_user.email,
                "telegramLinked": True,
            },
        )

        logger.info(
            "Telegram link completed for user %s (created_channel=%s, channel_id=%s)",
            current_user.uid,
            created_channel,
            channel_info.channel_id,
        )

        return TelegramLinkResult(
            linked=True,
            channel_id=channel_info.channel_id,
            telegram_user_id=verified["telegram_user_id"],
            username=verified.get("username"),
            created_channel=created_channel,
        )

    async def unlink(self, current_user: CurrentUser) -> None:
        logger.info("Unlinking Telegram storage for user %s", current_user.uid)
        await self._firestore.delete_telegram_storage(current_user.uid)
        await self._firestore.delete_telegram_provisioning(current_user.uid)
        await self._firestore.release_telegram_provisioning_lock(current_user.uid)
        await self._firestore.upsert_user_profile(
            current_user.uid,
            {
                "telegramLinked": False,
            },
        )

    async def get_storage(self, user_id: str) -> dict | None:
        return await self._firestore.get_telegram_storage(user_id)

    async def _provision_channel_under_lock(self, user_id: str, verified: dict) -> tuple[TelegramChannelInfo, bool]:
        provisioning = await self._firestore.get_telegram_provisioning(user_id)
        request_id = (provisioning or {}).get("requestId") or secrets.token_urlsafe(16)
        marker = (provisioning or {}).get("provisioningMarker") or f"pixlvault:{user_id}:{request_id}"
        title = (provisioning or {}).get("channelTitle") or self._default_channel_title(CurrentUser(uid=user_id), verified)
        about = (provisioning or {}).get("channelAbout") or f"Private user-owned media channel for PixlVault. uid={user_id} marker={marker}"
        heartbeat_task: asyncio.Task[None] | None = None
        lock_lost_event = asyncio.Event()

        while True:
            existing_storage = await self._firestore.get_telegram_storage(user_id)
            if existing_storage and existing_storage.get("channelId") and existing_storage.get("channelAccessHash"):
                logger.info("Storage appeared while provisioning; reusing channel for user %s", user_id)
                return TelegramChannelInfo(
                    channel_id=existing_storage["channelId"],
                    access_hash=existing_storage["channelAccessHash"],
                    title=existing_storage.get("channelTitle") or self._default_channel_title(CurrentUser(uid=user_id), verified),
                    about=existing_storage.get("channelAbout") or "Private user-owned media channel for PixlVault.",
                ), False

            acquired = await self._firestore.acquire_telegram_provisioning_lock(user_id, request_id=request_id)
            if acquired:
                heartbeat_task = asyncio.create_task(self._lock_heartbeat(user_id, request_id, lock_lost_event))
                break

            waited = await self._firestore.wait_for_telegram_storage(user_id, timeout_seconds=10)
            if waited and waited.get("channelId") and waited.get("channelAccessHash"):
                logger.info("Concurrent provisioning finished first for user %s", user_id)
                return TelegramChannelInfo(
                    channel_id=waited["channelId"],
                    access_hash=waited["channelAccessHash"],
                    title=waited.get("channelTitle") or self._default_channel_title(CurrentUser(uid=user_id), verified),
                    about=waited.get("channelAbout") or "Private user-owned media channel for PixlVault.",
                ), False

            waited_provisioning = await self._firestore.wait_for_telegram_provisioning(user_id, timeout_seconds=10)
            if waited_provisioning and waited_provisioning.get("status") == "provisioned" and waited_provisioning.get("channelId") and waited_provisioning.get("channelAccessHash"):
                logger.info("Concurrent provisioning record finished first for user %s", user_id)
                return TelegramChannelInfo(
                    channel_id=waited_provisioning["channelId"],
                    access_hash=waited_provisioning["channelAccessHash"],
                    title=waited_provisioning.get("channelTitle") or title,
                    about=waited_provisioning.get("channelAbout") or about,
                ), False

            if waited_provisioning and waited_provisioning.get("requestId"):
                request_id = waited_provisioning["requestId"]
                marker = waited_provisioning.get("provisioningMarker") or marker
                title = waited_provisioning.get("channelTitle") or title
                about = waited_provisioning.get("channelAbout") or about

            await asyncio.sleep(0.25)

        try:
            await self._firestore.save_telegram_provisioning(
                user_id,
                {
                    "requestId": request_id,
                    "userId": user_id,
                    "status": "creating",
                    "channelTitle": title,
                    "channelAbout": about,
                    "provisioningMarker": marker,
                },
            )

            final_storage = await self._firestore.get_telegram_storage(user_id)
            if final_storage and final_storage.get("channelId") and final_storage.get("channelAccessHash"):
                return TelegramChannelInfo(
                    channel_id=final_storage["channelId"],
                    access_hash=final_storage["channelAccessHash"],
                    title=final_storage.get("channelTitle") or f"PixlVault - {user_id}",
                    about=final_storage.get("channelAbout") or "Private user-owned media channel for PixlVault.",
                ), False

            if lock_lost_event.is_set():
                logger.warning("Provisioning lock lost for user %s before Telegram create; aborting safely", user_id)
                raise RuntimeError("Telegram provisioning lock was lost before channel creation; retry the request.")

            recovery_deadline = asyncio.get_event_loop().time() + 10
            while asyncio.get_event_loop().time() < recovery_deadline:
                recovered = await self._telegram.find_private_channel_by_marker(verified["session_string"], marker)
                if recovered:
                    logger.info("Recovered orphan Telegram channel for user %s using marker %s", user_id, marker)
                    await self._firestore.save_telegram_provisioning(
                        user_id,
                        {
                            "requestId": request_id,
                            "userId": user_id,
                            "status": "provisioned",
                            "channelId": recovered.channel_id,
                            "channelAccessHash": recovered.access_hash,
                            "channelTitle": recovered.title,
                            "channelAbout": recovered.about,
                            "provisioningMarker": marker,
                            "channelMarker": marker,
                        },
                    )
                    return recovered, False

                await asyncio.sleep(0.5)

                if lock_lost_event.is_set():
                    logger.warning("Provisioning lock lost for user %s during recovery polling; aborting safely", user_id)
                    raise RuntimeError("Telegram provisioning lock was lost during recovery; retry the request.")

            logger.info("Creating Telegram channel for user %s under lock", user_id)
            channel_info = await self._telegram.create_private_channel(verified["session_string"], title, about)
            await self._firestore.save_telegram_provisioning(
                user_id,
                {
                    "requestId": request_id,
                    "userId": user_id,
                    "status": "provisioned",
                    "channelId": channel_info.channel_id,
                    "channelAccessHash": channel_info.access_hash,
                    "channelTitle": channel_info.title,
                    "channelAbout": channel_info.about,
                    "provisioningMarker": marker,
                    "channelMarker": marker,
                },
            )
            storage_payload = {
                "encryptedSession": self._telegram.encrypt_session(verified["session_string"]),
                "telegramUserId": verified["telegram_user_id"],
                "telegramPhone": verified.get("phone"),
                "telegramUsername": verified.get("username"),
                "channelId": channel_info.channel_id,
                "channelAccessHash": channel_info.access_hash,
                "channelTitle": channel_info.title,
                "channelAbout": channel_info.about,
                "channelMarker": marker,
                "status": "linked",
            }
            await self._firestore.save_telegram_storage(user_id, storage_payload, create_new=True)
            return channel_info, True
        finally:
            if heartbeat_task:
                heartbeat_task.cancel()
                try:
                    await heartbeat_task
                except asyncio.CancelledError:
                    pass
            await self._firestore.release_telegram_provisioning_lock(user_id)

    async def _lock_heartbeat(self, user_id: str, request_id: str, lock_lost_event: asyncio.Event) -> None:
        try:
            while True:
                await asyncio.sleep(self.LOCK_HEARTBEAT_SECONDS)
                renewed = await self._firestore.renew_telegram_provisioning_lock(
                    user_id,
                    request_id=request_id,
                    ttl_seconds=self.LOCK_TTL_SECONDS,
                )
                if not renewed:
                    logger.warning("Provisioning lock heartbeat stopped for user %s; ownership was lost or lock expired", user_id)
                    lock_lost_event.set()
                    return

                logger.debug("Provisioning lock renewed for user %s", user_id)
        except asyncio.CancelledError:
            logger.debug("Provisioning lock heartbeat cancelled for user %s", user_id)
            raise
