from __future__ import annotations

import asyncio
from pathlib import Path
import logging
import time

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from starlette.responses import StreamingResponse

from app.dependencies import CurrentUser, get_current_user
from app.schemas.media import MediaItemResponse, MediaListResponse

router = APIRouter(prefix="/media", tags=["media"])
logger = logging.getLogger(__name__)


@router.post("/upload", response_model=MediaItemResponse)
async def upload_media(
    request: Request,
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(get_current_user),
) -> MediaItemResponse:
    media_service = request.app.state.media_service
    record = await media_service.upload_user_media(current_user.uid, current_user.name or current_user.uid, file)
    return MediaItemResponse(**record)


@router.get("", response_model=MediaListResponse)
async def list_media(
    request: Request,
    limit: int = Query(default=50, ge=1, le=100),
    cursor: str | None = Query(default=None),
    kind: str | None = Query(default=None, pattern="^(all|image|video|file)$"),
    current_user: CurrentUser = Depends(get_current_user),
) -> MediaListResponse:
    media_service = request.app.state.media_service
    items, next_cursor = await media_service.list_user_media(current_user.uid, limit=limit, cursor=cursor, media_kind=kind)
    return MediaListResponse(items=[MediaItemResponse(**item) for item in items], nextCursor=next_cursor)


@router.get("/{media_id}/thumbnail")
async def get_media_thumbnail(
    media_id: str,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
):
    media_service = request.app.state.media_service
    stream_started = time.perf_counter()
    result = await media_service.download_user_media_asset(current_user.uid, media_id, asset_kind="thumbnail")
    logger.info("thumbnail_served", extra={"event": "thumbnail_served", "media_id": media_id, "cache_status": "served"})
    return FileResponse(
        result.path,
        media_type=result.media_type or "image/jpeg",
        filename=result.filename,
        headers={"Cache-Control": "private, max-age=86400"},
        background=BackgroundTask(_safe_unlink, result.path) if result.delete_after_send else None,
    )


@router.get("/{media_id}/content")
async def get_media_content(
    media_id: str,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
):
    media_service = request.app.state.media_service
    stream_started = time.perf_counter()
    result = await media_service.download_user_media_asset(current_user.uid, media_id, asset_kind="content")
    logger.info("content_served", extra={"event": "content_served", "media_id": media_id, "stream_ms": round((time.perf_counter() - stream_started) * 1000, 2)})
    return FileResponse(
        result.path,
        media_type=result.media_type or "application/octet-stream",
        filename=result.filename,
        headers={"Cache-Control": "private, no-store"},
    )


@router.get("/{media_id}/stream-url")
async def get_media_stream_url(
    media_id: str,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
) -> dict[str, str | int]:
    media_service = request.app.state.media_service
    media_item = await media_service.get_user_media(current_user.uid, media_id)
    if media_item.get("mediaKind") not in {"video", "file"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Streaming is only supported for videos and files.")

    token = media_service.create_stream_token(current_user.uid, media_id, "content")
    logger.info("stream_url_issued", extra={"event": "stream_url_issued", "media_id": media_id, "media_kind": media_item.get("mediaKind")})
    return {
        "stream_url": f"{request.base_url}api/v1/media/{media_id}/stream?token={token}",
        "expires_in_seconds": request.app.state.settings.media_stream_token_ttl_seconds,
    }


@router.get("/{media_id}/stream")
async def stream_media(
    media_id: str,
    request: Request,
    token: str = Query(...),
) -> StreamingResponse:
    media_service = request.app.state.media_service
    stream_started = time.perf_counter()
    try:
        claims = media_service.decode_stream_token(token)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc

    if claims.get("kind") != "content":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid stream token kind.")

    media_descriptor = await media_service.get_stream_descriptor(claims["uid"], media_id)
    range_header = request.headers.get("range")
    start, end = _parse_range_header(range_header, media_descriptor.size_bytes)
    logger.info(
        "stream_request",
        extra={
            "event": "stream_request",
            "media_id": media_id,
            "range_header": range_header,
            "range_start": start,
            "range_end": end,
            "cache_status": "hit" if Path(media_descriptor.path).exists() else "miss",
        },
    )

    if start == 0 and end == media_descriptor.size_bytes - 1:
        return StreamingResponse(
            _file_iterator(request, media_descriptor.path),
            media_type=media_descriptor.media_type,
            headers={
                "Accept-Ranges": "bytes",
                "Content-Length": str(media_descriptor.size_bytes),
                "Cache-Control": "private, no-store",
            },
        )

    content_length = end - start + 1
    return StreamingResponse(
        _file_iterator(request, media_descriptor.path, start=start, end=end),
        status_code=status.HTTP_206_PARTIAL_CONTENT,
        media_type=media_descriptor.media_type,
        headers={
            "Accept-Ranges": "bytes",
            "Content-Range": f"bytes {start}-{end}/{media_descriptor.size_bytes}",
            "Content-Length": str(content_length),
            "Cache-Control": "private, no-store",
        },
    )


def _safe_unlink(path: str) -> None:
    import os

    if os.path.exists(path):
        os.unlink(path)


def _parse_range_header(range_header: str | None, size_bytes: int) -> tuple[int, int]:
    if not range_header:
                return 0, max(0, size_bytes - 1)

    if not range_header.startswith("bytes="):
        raise HTTPException(status_code=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE, detail="Invalid range header.")

    range_value = range_header.removeprefix("bytes=").split(",", 1)[0].strip()
    if "-" not in range_value:
        raise HTTPException(status_code=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE, detail="Invalid range header.")

    start_str, end_str = range_value.split("-", 1)
    if not start_str and not end_str:
        raise HTTPException(status_code=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE, detail="Invalid range header.")

    if start_str:
        start = int(start_str)
        end = int(end_str) if end_str else size_bytes - 1
    else:
        suffix_length = int(end_str)
        if suffix_length <= 0:
            raise HTTPException(status_code=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE, detail="Invalid range header.")
        start = max(0, size_bytes - suffix_length)
        end = size_bytes - 1

    if start < 0 or end < start or start >= size_bytes:
        raise HTTPException(status_code=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE, detail="Range out of bounds.")

    end = min(end, size_bytes - 1)
    return start, end


async def _file_iterator(request: Request, path: str, *, start: int = 0, end: int | None = None):
    chunk_size = 1024 * 1024
    file = await asyncio.to_thread(open, path, "rb")
    try:
        await asyncio.to_thread(file.seek, start)
        remaining = None if end is None else end - start + 1
        while True:
            if await request.is_disconnected():
                logger.info("stream_disconnected", extra={"event": "stream_disconnected", "media_id": request.path_params.get("media_id")})
                break

            read_size = chunk_size if remaining is None else min(chunk_size, remaining)
            if read_size <= 0:
                break

            chunk = await asyncio.to_thread(file.read, read_size)
            if not chunk:
                break

            if remaining is not None:
                remaining -= len(chunk)

            yield chunk
    finally:
        await asyncio.to_thread(file.close)
