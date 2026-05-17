from __future__ import annotations

from fastapi import APIRouter, Request, Header, HTTPException, status

from app.core.config import get_settings

router = APIRouter(prefix="/maintenance", tags=["maintenance"])


@router.post("/cleanup-telegram-challenges")
async def cleanup_telegram_challenges(request: Request, x_internal_token: str | None = Header(None)) -> dict:
    settings = get_settings()
    expected = settings.maintenance_auth_token
    if not expected:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail="Maintenance endpoint not configured.")
    if x_internal_token != expected:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid maintenance auth token.")

    firestore = request.app.state.firestore
    deleted = await firestore.cleanup_expired_telegram_login_challenges()
    return {"deleted": deleted}
