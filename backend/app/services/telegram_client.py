from __future__ import annotations

from dataclasses import dataclass
import logging
from typing import Any

from telethon import TelegramClient
from telethon.errors import (
    AuthKeyUnregisteredError,
    ChannelInvalidError,
    ChannelPrivateError,
    FloodWaitError,
    PhoneCodeExpiredError,
    PhoneCodeInvalidError,
    SessionPasswordNeededError,
    SessionRevokedError,
    UnauthorizedError,
    UserDeactivatedBanError,
)
from telethon.tl import functions
from telethon.sessions import StringSession
from telethon.tl.functions.channels import CreateChannelRequest
from telethon.tl.types import InputPeerChannel
from telethon.tl.types import Channel

from app.core.config import Settings
from app.services.encryption import SessionCryptographer
from app.core.observability import log_event
from app.utils.errors import TelegramFloodWaitError, TelegramTwoFactorRequiredError
from app.utils.errors import TelegramSessionInvalidError, TelegramStorageChannelMissingError


@dataclass(slots=True)
class TelegramChannelInfo:
    channel_id: int
    access_hash: int
    title: str
    about: str


@dataclass(slots=True)
class TelegramSessionStatus:
    authorized: bool
    telegram_user_id: int | None = None
    username: str | None = None
    phone: str | None = None


class TelegramService:
    def __init__(self, settings: Settings, cryptographer: SessionCryptographer) -> None:
        self._settings = settings
        self._cryptographer = cryptographer

    def decrypt_session(self, encrypted_session: str) -> str:
        return self._cryptographer.decrypt(encrypted_session)

    def encrypt_session(self, session_string: str) -> str:
        return self._cryptographer.encrypt(session_string)

    def _client(self, session_string: str | None = None) -> TelegramClient:
        return TelegramClient(
            StringSession(session_string or ""),
            self._settings.telegram_api_id,
            self._settings.telegram_api_hash,
        )

    @staticmethod
    def _channel_marker(about: str | None) -> str | None:
        if not about:
            return None

        marker_prefix = "marker="
        if marker_prefix not in about:
            return None

        marker = about.split(marker_prefix, 1)[1].split()[0].strip()
        return marker or None

    def _is_auth_session_error(self, exc: Exception) -> bool:
        return isinstance(
            exc,
            (
                AuthKeyUnregisteredError,
                SessionRevokedError,
                UserDeactivatedBanError,
                UnauthorizedError,
            ),
        )

    async def _run_with_floodwait(self, coroutine_factory):
        try:
            return await coroutine_factory()
        except FloodWaitError as exc:
            raise TelegramFloodWaitError(
                f"Telegram asked us to wait for {exc.seconds} seconds.",
                retry_after_seconds=exc.seconds,
            ) from exc

    async def validate_session(self, session_string: str) -> TelegramSessionStatus:
        client = self._client(session_string)
        await client.connect()
        try:
            try:
                authorized = await client.is_user_authorized()
            except Exception as exc:  # noqa: BLE001
                if self._is_auth_session_error(exc):
                    raise TelegramSessionInvalidError("Telegram session is no longer valid. Reconnect required.") from exc
                raise

            if not authorized:
                raise TelegramSessionInvalidError("Telegram session is no longer valid. Reconnect required.")

            try:
                me = await client.get_me()
            except Exception as exc:  # noqa: BLE001
                if self._is_auth_session_error(exc):
                    raise TelegramSessionInvalidError("Telegram session is no longer valid. Reconnect required.") from exc
                raise

            if not me:
                raise TelegramSessionInvalidError("Telegram session is no longer valid. Reconnect required.")

            return TelegramSessionStatus(
                authorized=True,
                telegram_user_id=me.id,
                username=getattr(me, "username", None),
                phone=getattr(me, "phone", None),
            )
        finally:
            await client.disconnect()

    async def ensure_storage_channel(
        self,
        session_string: str,
        *,
        channel_id: int | None,
        access_hash: int | None,
        title: str,
        about: str,
        marker: str | None,
    ) -> tuple[TelegramChannelInfo, bool, bool]:
        """Validate the current storage channel and recreate it if Telegram deleted it.

        Returns: (channel_info, recreated, stale_reference)
        """
        client = self._client(session_string)
        await client.connect()
        try:
            current_entity = None
            if channel_id and access_hash:
                try:
                    current_entity = await client.get_entity(InputPeerChannel(channel_id, access_hash))
                except (ChannelInvalidError, ChannelPrivateError, ValueError, TypeError, Exception) as exc:  # noqa: BLE001
                    if self._is_auth_session_error(exc):
                        raise TelegramSessionInvalidError("Telegram session is no longer valid. Reconnect required.") from exc
                    current_entity = None

            if current_entity is not None and getattr(current_entity, "id", None):
                resolved_title = getattr(current_entity, "title", None) or title
                resolved_about = about
                if marker:
                    try:
                        full = await client(functions.channels.GetFullChannelRequest(channel=current_entity))
                        fetched_about = getattr(full.full_chat, "about", None)
                        if fetched_about:
                            resolved_about = fetched_about
                    except Exception:  # noqa: BLE001
                        pass

                return TelegramChannelInfo(
                    channel_id=current_entity.id,
                    access_hash=getattr(current_entity, "access_hash", access_hash or 0),
                    title=resolved_title,
                    about=resolved_about,
                ), False, False

            if marker:
                recovered = await self.find_private_channel_by_marker(session_string, marker=marker)
                if recovered:
                    return recovered, False, True

            recreated = await self.create_private_channel(session_string, title, about)
            return recreated, True, True
        finally:
            await client.disconnect()

    async def request_login_code(self, phone_number: str) -> dict[str, Any]:
        client = self._client()
        await client.connect()
        try:
            log_event(logging.getLogger(__name__), logging.INFO, "telegram_otp_request_start", "Requesting Telegram OTP")
            result = await self._run_with_floodwait(lambda: client.send_code_request(phone_number))
            log_event(logging.getLogger(__name__), logging.INFO, "telegram_otp_request_complete", "Telegram OTP requested", telegram_status="ok")
            # Persist the session string so the same auth state can be reused for verification
            session_string = client.session.save()
            return {
                "phone_code_hash": result.phone_code_hash,
                "phone_number": phone_number,
                "session_string": session_string,
            }
        except TelegramFloodWaitError as exc:
            log_event(logging.getLogger(__name__), logging.WARNING, "telegram_flood_wait", "Telegram flood wait during OTP request", flood_wait_seconds=exc.retry_after_seconds)
            raise
        finally:
            await client.disconnect()

    async def verify_login_code(
        self,
        phone_number: str,
        phone_code_hash: str,
        code: str,
        two_factor_password: str | None = None,
        session_string: str | None = None,
    ) -> dict[str, Any]:
        client = self._client(session_string)
        await client.connect()

        try:
            log_event(logging.getLogger(__name__), logging.INFO, "telegram_otp_verify_start", "Verifying Telegram OTP")
            try:
                await self._run_with_floodwait(
                    lambda: client.sign_in(phone=phone_number, code=code, phone_code_hash=phone_code_hash)
                )
            except SessionPasswordNeededError as exc:
                if not two_factor_password:
                    raise TelegramTwoFactorRequiredError("Telegram account has 2FA enabled and requires a password.") from exc
                await self._run_with_floodwait(lambda: client.sign_in(password=two_factor_password))
            except PhoneCodeInvalidError as exc:
                raise ValueError("The Telegram OTP code is invalid.") from exc
            except PhoneCodeExpiredError as exc:
                raise ValueError("The Telegram OTP code is no longer valid. It may have expired or been replaced by a newer request.") from exc

            me = await client.get_me()
            session_string = client.session.save()
            log_event(logging.getLogger(__name__), logging.INFO, "telegram_otp_verify_complete", "Telegram OTP verified", telegram_status="ok")
            return {
                "session_string": session_string,
                "telegram_user_id": me.id,
                "phone": getattr(me, "phone", None),
                "first_name": getattr(me, "first_name", None),
                "last_name": getattr(me, "last_name", None),
                "username": getattr(me, "username", None),
            }
        finally:
            await client.disconnect()

    async def create_private_channel(self, session_string: str, title: str, about: str) -> TelegramChannelInfo:
        client = self._client(session_string)
        await client.connect()
        try:
            log_event(logging.getLogger(__name__), logging.INFO, "telegram_channel_create_start", "Creating Telegram private channel")
            result = await self._run_with_floodwait(
                lambda: client(CreateChannelRequest(title=title, about=about, megagroup=False, broadcast=True))
            )
            channel = next(chat for chat in result.chats if isinstance(chat, Channel))
            log_event(logging.getLogger(__name__), logging.INFO, "telegram_channel_create_complete", "Telegram private channel created", channel_id=channel.id)
            return TelegramChannelInfo(channel_id=channel.id, access_hash=channel.access_hash, title=title, about=about)
        finally:
            await client.disconnect()

    async def find_private_channel_by_marker(self, session_string: str, marker: str) -> TelegramChannelInfo | None:
        client = self._client(session_string)
        await client.connect()
        try:
            async for dialog in client.iter_dialogs():
                entity = dialog.entity
                if not isinstance(entity, Channel):
                    continue

                full = await self._run_with_floodwait(lambda: client(functions.channels.GetFullChannelRequest(channel=entity)))
                about = getattr(full.full_chat, "about", None) or ""
                if marker in about:
                    return TelegramChannelInfo(
                        channel_id=entity.id,
                        access_hash=entity.access_hash,
                        title=entity.title,
                        about=about,
                    )

            return None
        finally:
            await client.disconnect()

    async def upload_media(
        self,
        session_string: str,
        channel_id: int,
        channel_access_hash: int,
        source_path: str,
        filename: str,
        caption: str,
        mime_type: str | None = None,
        thumbnail_path: str | None = None,
    ) -> dict[str, Any]:
        client = self._client(session_string)
        await client.connect()
        try:
            logger = logging.getLogger(__name__)
            log_event(logger, logging.INFO, "telegram_upload_start", "Uploading media to Telegram", channel_id=channel_id)
            channel_entity = InputPeerChannel(channel_id, channel_access_hash)
            original = await self._run_with_floodwait(
                lambda: client.send_file(
                    entity=channel_entity,
                    file=source_path,
                    caption=caption,
                    force_document=True,
                    file_name=filename,
                    supports_streaming=(mime_type or "").startswith("video/"),
                )
            )

            thumbnail_message = None
            if thumbnail_path:
                thumbnail_message = await self._run_with_floodwait(
                    lambda: client.send_file(
                        entity=channel_entity,
                        file=thumbnail_path,
                        caption="PixlVault internal thumbnail",
                        force_document=False,
                    )
                )

            log_event(
                logger,
                logging.INFO,
                "telegram_upload_complete",
                "Telegram upload completed",
                channel_id=channel_id,
                message_id=original.id,
                thumbnail_message_id=getattr(thumbnail_message, "id", None),
            )
            return {
                "message_id": original.id,
                "channel_id": channel_id,
                "thumbnail_message_id": getattr(thumbnail_message, "id", None),
            }
        finally:
            await client.disconnect()

    async def download_message_media(
        self,
        session_string: str,
        channel_id: int,
        channel_access_hash: int,
        message_id: int,
        target_path: str,
    ) -> str:
        client = self._client(session_string)
        await client.connect()
        try:
            logger = logging.getLogger(__name__)
            log_event(logger, logging.INFO, "telegram_download_start", "Downloading Telegram media", channel_id=channel_id, message_id=message_id)
            channel_entity = InputPeerChannel(channel_id, channel_access_hash)
            message = await client.get_messages(channel_entity, ids=message_id)
            if not message:
                raise ValueError("Telegram media message was not found.")

            result_path = await self._run_with_floodwait(lambda: client.download_media(message, file=target_path))
            if not result_path:
                raise ValueError("Telegram media download failed.")

            log_event(logger, logging.INFO, "telegram_download_complete", "Telegram media downloaded", channel_id=channel_id, message_id=message_id)

            return str(result_path)
        finally:
            await client.disconnect()
