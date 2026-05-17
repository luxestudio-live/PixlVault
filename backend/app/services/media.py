from __future__ import annotations

import asyncio
import base64
from dataclasses import dataclass
import hashlib
import hmac
import json
import logging
import os
import shutil
import tempfile
import time
import uuid
from pathlib import Path

from fastapi import UploadFile

from app.core.config import Settings
from app.core.observability import log_event
from app.services.encryption import SessionCryptographer
from app.services.firestore import FirestoreRepository
from app.services.telegram_client import TelegramChannelInfo, TelegramService
from app.services.thumbnail import ThumbnailService
from app.utils.errors import TelegramNotLinkedError, TelegramSessionInvalidError, TelegramSessionMissingError, TelegramStorageChannelMissingError

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class MediaDownloadResult:
    path: str
    media_type: str | None
    filename: str | None
    delete_after_send: bool = False


@dataclass(slots=True)
class MediaStreamDescriptor:
    path: str
    media_type: str | None
    filename: str | None
    size_bytes: int


class MediaService:
    def __init__(
        self,
        settings: Settings,
        firestore: FirestoreRepository,
        telegram: TelegramService,
        thumbnails: ThumbnailService,
        cryptographer: SessionCryptographer,
    ) -> None:
        self._settings = settings
        self._firestore = firestore
        self._telegram = telegram
        self._thumbnails = thumbnails
        self._cryptographer = cryptographer

        Path(self._settings.upload_temp_dir).mkdir(parents=True, exist_ok=True)
        self._media_cache_dir = Path(self._settings.upload_temp_dir) / "media-cache"
        self._thumbnail_cache_dir = self._media_cache_dir / "thumbnails"
        self._content_cache_dir = self._media_cache_dir / "content"
        self._thumbnail_cache_dir.mkdir(parents=True, exist_ok=True)
        self._content_cache_dir.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _extract_channel_marker(about: str | None) -> str | None:
        if not about or "marker=" not in about:
            return None

        marker = about.split("marker=", 1)[1].split()[0].strip()
        return marker or None

    async def _ensure_storage_channel(self, user_id: str, *, session_doc: dict) -> tuple[str, TelegramChannelInfo]:
        encrypted_session = session_doc.get("encryptedSession")
        channel_id = session_doc.get("channelId")
        channel_access_hash = session_doc.get("channelAccessHash")
        channel_title = session_doc.get("channelTitle") or "PixlVault Private Channel"
        channel_about = session_doc.get("channelAbout") or f"Private user-owned media channel for PixlVault. uid={user_id}"
        marker = session_doc.get("channelMarker") or self._extract_channel_marker(channel_about) or f"pixlvault:{user_id}:{uuid.uuid4().hex}"

        if not encrypted_session:
            raise TelegramSessionMissingError("Telegram is not linked for this user.")

        session_string = self._cryptographer.decrypt(encrypted_session)
        try:
            await self._telegram.validate_session(session_string)
        except TelegramSessionInvalidError as exc:
            logger.warning(
                "Invalid Telegram session detected while validating storage channel for user %s",
                user_id,
                extra={"event": "telegram_session_invalid", "telegram_status": "invalid"},
            )
            await self._firestore.invalidate_telegram_storage(user_id, reason=str(exc))
            raise TelegramSessionMissingError("Telegram session expired. Reconnect required.") from exc

        channel_info, recreated, stale_reference = await self._telegram.ensure_storage_channel(
            session_string,
            channel_id=channel_id,
            access_hash=channel_access_hash,
            title=channel_title,
            about=channel_about if "marker=" in channel_about else f"{channel_about} marker={marker}",
            marker=marker,
        )

        validation_status = "recovered" if (recreated or stale_reference) else "valid"
        if recreated or stale_reference:
            logger.info(
                "Storage channel recovered for user %s (recreated=%s stale_reference=%s channel_id=%s)",
                user_id,
                recreated,
                stale_reference,
                channel_info.channel_id,
                extra={"event": "telegram_storage_channel_recovered", "telegram_status": "recovered"},
            )

        await self._firestore.save_telegram_storage(
            user_id,
            {
                **session_doc,
                "encryptedSession": encrypted_session,
                "channelId": channel_info.channel_id,
                "channelAccessHash": channel_info.access_hash,
                "channelTitle": channel_info.title,
                "channelAbout": channel_info.about,
                "channelMarker": marker,
                "status": "linked",
                "channelValidationStatus": validation_status,
            },
            create_new=False,
        )

        return session_string, channel_info

    def create_stream_token(self, user_id: str, media_id: str, kind: str) -> str:
        payload = {
            "uid": user_id,
            "mediaId": media_id,
            "kind": kind,
            "exp": int(time.time()) + self._settings.media_stream_token_ttl_seconds,
        }
        payload_bytes = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        signature = hmac.new(
            self._cryptographer._key,  # noqa: SLF001 - reused for short-lived internal stream signing
            payload_bytes,
            hashlib.sha256,
        ).digest()
        token_bytes = base64.urlsafe_b64encode(payload_bytes + b"." + signature)
        return token_bytes.decode("utf-8")

    def decode_stream_token(self, token: str) -> dict[str, str]:
        raw = base64.urlsafe_b64decode(token.encode("utf-8"))
        payload_bytes, signature = raw.rsplit(b".", 1)
        expected_signature = hmac.new(self._cryptographer._key, payload_bytes, hashlib.sha256).digest()  # noqa: SLF001
        if not hmac.compare_digest(signature, expected_signature):
            raise ValueError("Invalid stream token.")

        payload = json.loads(payload_bytes.decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("Invalid stream token.")

        exp = int(payload.get("exp") or 0)
        if exp < int(time.time()):
            raise ValueError("Stream token expired.")

        return {
            "uid": str(payload.get("uid") or ""),
            "mediaId": str(payload.get("mediaId") or ""),
            "kind": str(payload.get("kind") or ""),
        }

    async def _write_upload_to_tempfile(self, upload_file: UploadFile) -> str:
        suffix = Path(upload_file.filename or "upload.bin").suffix
        temp_file = tempfile.NamedTemporaryFile(delete=False, dir=self._settings.upload_temp_dir, suffix=suffix)
        temp_file.close()

        def _copy() -> None:
            with open(temp_file.name, "wb") as output:
                upload_file.file.seek(0)
                shutil.copyfileobj(upload_file.file, output)

        await asyncio.to_thread(_copy)
        return temp_file.name

    async def upload_user_media(self, user_id: str, display_name: str, upload_file: UploadFile) -> dict:
        logger = logging.getLogger(__name__)
        upload_started = time.perf_counter()
        log_event(logger, logging.INFO, "upload_start", "Upload started", media_kind=self._classify_media_kind(upload_file.content_type, upload_file.filename or ""))

        session_doc = await self._firestore.get_telegram_storage(user_id)
        if not session_doc:
            logger.warning("Upload attempted without linked Telegram session for user %s", user_id)
            raise TelegramSessionMissingError("Telegram is not linked for this user.")

        session_string, channel = await self._ensure_storage_channel(user_id, session_doc=session_doc)

        original_path = await self._write_upload_to_tempfile(upload_file)
        thumbnail_path: str | None = None

        try:
            thumbnail_started = time.perf_counter()
            thumbnail_path, _thumbnail_mime_type = await self._thumbnails.build_thumbnail(
                original_path,
                upload_file.filename or "upload.bin",
                upload_file.content_type,
            )
            log_event(logger, logging.INFO, "thumbnail_complete", "Thumbnail generated", thumbnail_ms=round((time.perf_counter() - thumbnail_started) * 1000, 2))

            uploaded = await self._telegram.upload_media(
                session_string=session_string,
                channel_id=channel.channel_id,
                channel_access_hash=channel.access_hash,
                source_path=original_path,
                filename=upload_file.filename or f"{uuid.uuid4().hex}.bin",
                caption=f"Uploaded by {display_name or user_id}",
                mime_type=upload_file.content_type,
                thumbnail_path=thumbnail_path,
            )

            media_id = uuid.uuid4().hex
            media_kind = self._classify_media_kind(upload_file.content_type, upload_file.filename or "")
            record = {
                "mediaId": media_id,
                "userId": user_id,
                "channelId": channel.channel_id,
                "messageId": uploaded["message_id"],
                "thumbnailMessageId": uploaded.get("thumbnail_message_id"),
                "filename": upload_file.filename,
                "mimeType": upload_file.content_type,
                "thumbnailMimeType": "image/jpeg",
                "mediaKind": media_kind,
                "status": "ready",
                "storageBackend": "telegram",
                "originalSizeBytes": os.path.getsize(original_path),
            }
            await self._firestore.save_media_item(media_id, record)
            log_event(logger, logging.INFO, "firestore_media_persisted", "Media metadata persisted", media_id=media_id)

            if thumbnail_path and os.path.exists(thumbnail_path):
                cached_thumbnail = self._thumbnail_cache_dir / f"{media_id}.jpg"
                shutil.copyfile(thumbnail_path, cached_thumbnail)

            log_event(
                logger,
                logging.INFO,
                "upload_complete",
                "Upload completed",
                media_id=media_id,
                channel_id=channel.channel_id,
                message_id=uploaded["message_id"],
                thumbnail_message_id=uploaded.get("thumbnail_message_id"),
                upload_ms=round((time.perf_counter() - upload_started) * 1000, 2),
            )
            return record
        finally:
            if os.path.exists(original_path):
                os.unlink(original_path)
            if thumbnail_path and os.path.exists(thumbnail_path):
                os.unlink(thumbnail_path)

    async def list_user_media(
        self,
        user_id: str,
        limit: int = 50,
        *,
        cursor: str | None = None,
        media_kind: str | None = None,
    ) -> tuple[list[dict], str | None]:
        query_started = time.perf_counter()
        cursor_payload = self._firestore.decode_media_cursor(cursor) if cursor else None
        items, next_cursor = await self._firestore.list_media_items(user_id, limit=limit, cursor=cursor_payload, media_kind=media_kind)
        log_event(
            logging.getLogger(__name__),
            logging.INFO,
            "gallery_query_complete",
            "Gallery query completed",
            query_ms=round((time.perf_counter() - query_started) * 1000, 2),
            retry_count=0,
            media_kind=media_kind or "all",
        )
        return items, next_cursor

    async def get_user_media(self, user_id: str, media_id: str) -> dict:
        media_item = await self._firestore.get_media_item(media_id)
        if not media_item or media_item.get("userId") != user_id:
            raise TelegramNotLinkedError("Media item was not found for this user.")
        return media_item

    def _classify_media_kind(self, mime_type: str | None, filename: str) -> str:
        if (mime_type or "").startswith("image/"):
            return "image"
        if (mime_type or "").startswith("video/"):
            return "video"

        suffix = Path(filename).suffix.lower()
        if suffix in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
            return "image"
        if suffix in {".mp4", ".mov", ".mkv", ".webm"}:
            return "video"
        return "file"

    async def download_user_media_asset(self, user_id: str, media_id: str, *, asset_kind: str) -> MediaDownloadResult:
        logger = logging.getLogger(__name__)
        stream_started = time.perf_counter()
        media_item = await self.get_user_media(user_id, media_id)
        session_doc = await self._firestore.get_telegram_storage(user_id)
        if not session_doc:
            raise TelegramSessionMissingError("Telegram is not linked for this user.")

        session_string, channel = await self._ensure_storage_channel(user_id, session_doc=session_doc)

        if asset_kind == "thumbnail":
            cached_path = self._thumbnail_cache_dir / f"{media_id}.jpg"
            if cached_path.exists():
                log_event(logger, logging.INFO, "thumbnail_cache_hit", "Thumbnail cache hit", media_id=media_id, cache_status="hit")
                return MediaDownloadResult(path=str(cached_path), media_type=media_item.get("thumbnailMimeType") or "image/jpeg", filename=f"{media_id}.jpg")

            log_event(logger, logging.INFO, "thumbnail_cache_miss", "Thumbnail cache miss", media_id=media_id, cache_status="miss")

            thumbnail_message_id = media_item.get("thumbnailMessageId")
            if not thumbnail_message_id:
                placeholder_path, media_type = await self._thumbnails.build_placeholder_thumbnail(media_item.get("filename") or f"{media_id}.bin")
                return MediaDownloadResult(path=placeholder_path, media_type=media_type, filename=f"{media_id}.jpg", delete_after_send=True)

            try:
                result_path = await self._telegram.download_message_media(
                    session_string=session_string,
                    channel_id=channel.channel_id,
                    channel_access_hash=channel.access_hash,
                    message_id=thumbnail_message_id,
                    target_path=str(cached_path),
                )
                log_event(logger, logging.INFO, "thumbnail_download_complete", "Thumbnail downloaded", media_id=media_id, stream_ms=round((time.perf_counter() - stream_started) * 1000, 2))
                return MediaDownloadResult(path=result_path, media_type=media_item.get("thumbnailMimeType") or "image/jpeg", filename=f"{media_id}.jpg")
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "Thumbnail unavailable for user %s media %s; marking media unavailable",
                    user_id,
                    media_id,
                    extra={"event": "telegram_storage_media_missing", "telegram_status": "degraded"},
                )
                await self._firestore.mark_media_unavailable(media_id, reason=str(exc))
                placeholder_path, media_type = await self._thumbnails.build_placeholder_thumbnail(media_item.get("filename") or f"{media_id}.bin")
                return MediaDownloadResult(path=placeholder_path, media_type=media_type, filename=f"{media_id}.jpg", delete_after_send=True)

        cached_ext = Path(media_item.get("filename") or "asset.bin").suffix or ".bin"
        cached_path = self._content_cache_dir / f"{media_id}{cached_ext}"
        if cached_path.exists():
            log_event(logger, logging.INFO, "content_cache_hit", "Media content cache hit", media_id=media_id, cache_status="hit")
            return MediaDownloadResult(path=str(cached_path), media_type=media_item.get("mimeType"), filename=media_item.get("filename"))

        log_event(logger, logging.INFO, "content_cache_miss", "Media content cache miss", media_id=media_id, cache_status="miss")

        try:
            result_path = await self._telegram.download_message_media(
                session_string=session_string,
                channel_id=channel.channel_id,
                channel_access_hash=channel.access_hash,
                message_id=media_item["messageId"],
                target_path=str(cached_path),
            )
            log_event(logger, logging.INFO, "content_download_complete", "Media content downloaded", media_id=media_id, stream_ms=round((time.perf_counter() - stream_started) * 1000, 2))
            return MediaDownloadResult(path=result_path, media_type=media_item.get("mimeType"), filename=media_item.get("filename"))
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Content unavailable for user %s media %s; marking media unavailable",
                user_id,
                media_id,
                extra={"event": "telegram_storage_media_missing", "telegram_status": "degraded"},
            )
            await self._firestore.mark_media_unavailable(media_id, reason=str(exc))
            raise TelegramStorageChannelMissingError("Telegram storage channel is unavailable. Reconnect or recover required.") from exc

    async def get_stream_descriptor(self, user_id: str, media_id: str) -> MediaStreamDescriptor:
        media_item = await self.get_user_media(user_id, media_id)
        cached_ext = Path(media_item.get("filename") or "asset.bin").suffix or ".bin"
        cached_path = self._content_cache_dir / f"{media_id}{cached_ext}"

        if not cached_path.exists():
            await self.download_user_media_asset(user_id, media_id, asset_kind="content")

        if not cached_path.exists():
            raise TelegramNotLinkedError("Media content could not be prepared for streaming.")

        return MediaStreamDescriptor(
            path=str(cached_path),
            media_type=media_item.get("mimeType") or "application/octet-stream",
            filename=media_item.get("filename") or f"{media_id}{cached_ext}",
            size_bytes=os.path.getsize(cached_path),
        )
