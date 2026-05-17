from pydantic import BaseModel


class MediaItemResponse(BaseModel):
    mediaId: str
    userId: str
    channelId: int
    messageId: int
    thumbnailMessageId: int | None = None
    filename: str | None = None
    mimeType: str | None = None
    thumbnailMimeType: str | None = None
    mediaKind: str
    status: str
    storageBackend: str
    availabilityReason: str | None = None
    originalSizeBytes: int | None = None
    createdAt: str | None = None
    updatedAt: str | None = None


class MediaListResponse(BaseModel):
    items: list[MediaItemResponse]
    nextCursor: str | None = None
