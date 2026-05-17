from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from telethon.errors import PhoneNumberBannedError, PhoneNumberFloodError, PhoneNumberInvalidError

from app.dependencies import CurrentUser, get_current_user
from app.schemas.telegram import (
    TelegramLinkResponse,
    TelegramOtpRequest,
    TelegramOtpRequestResponse,
    TelegramOtpVerifyRequest,
    TelegramStatusResponse,
)
from app.utils.errors import TelegramFloodWaitError, TelegramSessionInvalidError, TelegramTwoFactorRequiredError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/telegram", tags=["telegram"])


@router.post("/request-otp", response_model=TelegramOtpRequestResponse)
async def request_otp(
    payload: TelegramOtpRequest,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
) -> TelegramOtpRequestResponse:
    telegram = request.app.state.telegram
    firestore = request.app.state.firestore

    challenge_id = secrets.token_urlsafe(24)
    request_id = getattr(request.state, "request_id", secrets.token_urlsafe(12))
    logger.info(
        "Requesting fresh Telegram OTP for user %s phone %s (force_resend=%s channel_name=%s) request_id=%s",
        current_user.uid,
        payload.phone_number,
        payload.force_resend,
        payload.channel_name,
        request_id,
    )

    # Acquire a short-lived lock for this user+phone to prevent concurrent OTP requests
    locked = await firestore.acquire_telegram_challenge_lock(current_user.uid, payload.phone_number, request_id=request_id, ttl_seconds=30)
    if not locked:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Another OTP request is in progress. Try again shortly.")

    try:
        await firestore.delete_active_telegram_login_challenges(current_user.uid, payload.phone_number)
        challenge = await telegram.request_login_code(payload.phone_number)
    except PhoneNumberInvalidError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Enter a valid Telegram phone number.") from exc
    except PhoneNumberBannedError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="That Telegram number is banned.") from exc
    except PhoneNumberFloodError as exc:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Telegram is rate limiting this number. Try again later.") from exc

    expires_at = datetime.now(timezone.utc) + timedelta(minutes=5)
    # Encrypt and persist the Telethon session string along with the phone_code_hash
    session_string = challenge.get("session_string")
    encrypted_session = telegram.encrypt_session(session_string) if session_string else None

    await firestore.save_telegram_login_challenge(
        challenge_id,
        {
            "challengeId": challenge_id,
            "userId": current_user.uid,
            "phoneNumber": payload.phone_number,
            "channelName": payload.channel_name,
            "phoneCodeHash": challenge["phone_code_hash"],
            "sessionString": encrypted_session,
            "expiresAt": expires_at,
            "status": "otp_sent",
        },
    )

    logger.info(
        "Telegram OTP issued for user %s phone %s (challenge_id=%s phone_code_hash=%s)",
        current_user.uid,
        payload.phone_number,
        challenge_id,
        challenge.get("phone_code_hash"),
    )

    # release the OTP request lock
    await firestore.release_telegram_challenge_lock(current_user.uid, payload.phone_number, request_id=request_id)
    return TelegramOtpRequestResponse(
        challenge_id=challenge_id,
        phone_number=payload.phone_number,
        expires_in_seconds=300,
    )


@router.post("/verify-otp", response_model=TelegramLinkResponse)
async def verify_otp(
    payload: TelegramOtpVerifyRequest,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
) -> TelegramLinkResponse:
    telegram = request.app.state.telegram
    firestore = request.app.state.firestore

    challenge = await firestore.get_telegram_login_challenge(payload.challenge_id)
    if not challenge:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="OTP challenge not found.")
    if challenge.get("userId") != current_user.uid:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="OTP challenge does not belong to this user.")

    expires_at = challenge.get("expiresAt")
    if expires_at and hasattr(expires_at, "replace") and expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="OTP challenge has expired.")

    try:
        logger.info(
            "Verifying Telegram OTP for user %s challenge_id=%s phone_code_hash=%s",
            current_user.uid,
            payload.challenge_id,
            challenge.get("phoneCodeHash"),
        )

        encrypted_session = challenge.get("sessionString")
        session_string = telegram.decrypt_session(encrypted_session) if encrypted_session else None

        verified = await telegram.verify_login_code(
            phone_number=challenge["phoneNumber"],
            phone_code_hash=challenge["phoneCodeHash"],
            code=payload.otp_code,
            two_factor_password=payload.two_factor_password,
            session_string=session_string,
        )
        verified["channel_name"] = challenge.get("channelName")
    except TelegramTwoFactorRequiredError as exc:
        logger.exception("Telegram requires 2FA for user %s during OTP verify", current_user.uid)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=exc.message) from exc
    except TelegramFloodWaitError as exc:
        logger.exception("Telegram flood-wait for user %s during OTP verify", current_user.uid)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"message": exc.message, "retry_after_seconds": exc.retry_after_seconds},
        ) from exc
    except ValueError as exc:
        logger.exception("Telegram OTP verification failed for user %s: %s", current_user.uid, str(exc))
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    logger.info("OTP verified for user %s; finalizing Telegram link", current_user.uid)

    telegram_linking = request.app.state.telegram_linking
    try:
        result = await telegram_linking.complete_link(current_user, verified)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    await firestore.delete_telegram_login_challenge(payload.challenge_id)

    return TelegramLinkResponse(
        linked=result.linked,
        channel_id=result.channel_id,
        telegram_user_id=result.telegram_user_id,
        username=result.username,
    )


@router.delete("/link")
async def unlink_telegram(request: Request, current_user: CurrentUser = Depends(get_current_user)) -> dict[str, bool]:
    telegram_linking = request.app.state.telegram_linking
    await telegram_linking.unlink(current_user)
    return {"unlinked": True}


@router.post("/reset-storage")
async def reset_storage(request: Request, current_user: CurrentUser = Depends(get_current_user)) -> dict[str, str]:
    logger.warning("Storage reset requested for user %s but the destructive flow is intentionally deferred", current_user.uid)
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="Telegram storage reset flow is reserved for a later release.",
    )


@router.get("/status", response_model=TelegramStatusResponse)
async def telegram_status(request: Request, current_user: CurrentUser = Depends(get_current_user)) -> TelegramStatusResponse:
    firestore = request.app.state.firestore
    session_doc = await firestore.get_telegram_storage(current_user.uid)
    if not session_doc:
        return TelegramStatusResponse(linked=False, reconnect_required=False)

    encrypted_session = session_doc.get("encryptedSession")
    if not encrypted_session or session_doc.get("status") == "disconnected":
        return TelegramStatusResponse(
            linked=False,
            channel_id=session_doc.get("channelId"),
            telegram_username=session_doc.get("telegramUsername"),
            reconnect_required=True,
            reason=session_doc.get("sessionInvalidReason") or "telegram_session_expired",
        )

    telegram = request.app.state.telegram
    try:
        session_string = telegram.decrypt_session(encrypted_session)
        await telegram.validate_session(session_string)
    except TelegramSessionInvalidError as exc:
        logger.warning(
            "Revoked Telegram session detected for user %s during status check", current_user.uid,
            extra={"event": "telegram_session_invalid", "telegram_status": "invalid"},
        )
        await firestore.invalidate_telegram_storage(current_user.uid, reason=str(exc))
        return TelegramStatusResponse(
            linked=False,
            channel_id=session_doc.get("channelId"),
            telegram_username=session_doc.get("telegramUsername"),
            reconnect_required=True,
            reason="telegram_session_expired",
        )

    return TelegramStatusResponse(
        linked=True,
        channel_id=session_doc.get("channelId"),
        telegram_username=session_doc.get("telegramUsername"),
        reconnect_required=False,
    )
