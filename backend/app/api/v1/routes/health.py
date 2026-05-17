from pathlib import Path

from firebase_admin import get_app as get_firebase_app
from fastapi import APIRouter, HTTPException, Request, status

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/ready")
async def ready(request: Request) -> dict[str, str]:
    settings = request.app.state.settings
    firestore = request.app.state.firestore
    temp_dir = Path(settings.upload_temp_dir)

    try:
        get_firebase_app()
        await firestore.get_now_utc()
        temp_dir.mkdir(parents=True, exist_ok=True)
        probe = temp_dir / ".pixlvault-readiness"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Backend readiness check failed.") from exc

    return {"status": "ready"}
