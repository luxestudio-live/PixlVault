export type TelegramStatus = {
  linked: boolean;
  channel_id?: number | null;
  telegram_username?: string | null;
  reconnect_required?: boolean;
  reason?: string | null;
};

export type MediaKind = 'all' | 'image' | 'video' | 'file';

export type MediaItem = {
  mediaId: string;
  userId: string;
  channelId: number;
  messageId: number;
  thumbnailMessageId?: number | null;
  filename?: string | null;
  mimeType?: string | null;
  thumbnailMimeType?: string | null;
  mediaKind: Exclude<MediaKind, 'all'>;
  status: string;
  storageBackend: string;
  availabilityReason?: string | null;
  originalSizeBytes?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type MediaListPage = {
  items: MediaItem[];
  nextCursor?: string | null;
};
