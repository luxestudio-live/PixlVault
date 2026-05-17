from fastapi import APIRouter

from app.api.v1.routes.health import router as health_router
from app.api.v1.routes.media import router as media_router
from app.api.v1.routes.maintenance import router as maintenance_router
from app.api.v1.routes.telegram import router as telegram_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(telegram_router)
api_router.include_router(media_router)
api_router.include_router(maintenance_router)
