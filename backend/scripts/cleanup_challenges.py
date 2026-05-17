"""
Run this script to remove expired Telegram OTP challenge documents from Firestore.
Usage:
    python -m backend.scripts.cleanup_challenges

This will use the same application settings and ServiceAccount (if configured) as the running backend.
"""
import asyncio

from app.core.config import get_settings
from app.services.firestore import FirestoreRepository


async def main() -> None:
    settings = get_settings()
    repo = FirestoreRepository(settings)
    deleted = await repo.cleanup_expired_telegram_login_challenges()
    print(f"Deleted {deleted} expired telegram challenge(s)")


if __name__ == "__main__":
    asyncio.run(main())
