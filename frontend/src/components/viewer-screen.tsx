"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowLeftCircle,
  ArrowRightCircle,
  Download,
  Info,
  Loader2,
  Maximize2,
  Minimize2,
  PictureInPicture2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useRouter, useSearchParams } from 'next/navigation';

import { useAuth } from '@/components/auth-provider';
import { fetchMediaAssetBlob, fetchMediaStreamUrl } from '@/lib/api';
import type { MediaItem, MediaKind } from '@/lib/types';

const M: any = motion;
const GALLERY_CONTEXT_KEY = 'pixlvault.galleryContext';
const VIEWER_CONTEXT_KEY = 'pixlvault.viewerContext';
const MAX_CACHE_ENTRIES = 6;

type ViewerScreenProps = {
  mediaId: string;
};

type ViewerTransitionPayload = {
  mediaId: string;
  thumbnailUrl: string | null;
  rect: {
    top: number;
    left: number;
    width: number;
    height: number;
  };
  ts: number;
};

type GalleryContextPayload = {
  filter: MediaKind;
  nextCursor: string | null;
  items: MediaItem[];
  ts: number;
};

type ViewerContextPayload = GalleryContextPayload & {
  mediaId: string;
  index: number;
};

type CacheEntry = {
  kind: 'image' | 'video';
  url: string;
  revoke: boolean;
};

type SwipeState = {
  pointerId: number;
  startX: number;
  startY: number;
  startedAt: number;
};

function readStoredContext(): ViewerContextPayload | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const candidates = [VIEWER_CONTEXT_KEY, GALLERY_CONTEXT_KEY];
  for (const key of candidates) {
    try {
      const raw = window.sessionStorage.getItem(key);
      if (!raw) {
        continue;
      }

      const payload = JSON.parse(raw) as Partial<ViewerContextPayload>;
      if (!payload || !Array.isArray(payload.items)) {
        continue;
      }

      const items = payload.items as MediaItem[];
      const mediaId = typeof payload.mediaId === 'string' ? payload.mediaId : items[0]?.mediaId;
      if (!mediaId) {
        continue;
      }

      return {
        mediaId,
        index: typeof payload.index === 'number' ? payload.index : Math.max(0, items.findIndex((item) => item.mediaId === mediaId)),
        filter: payload.filter === 'image' || payload.filter === 'video' || payload.filter === 'file' || payload.filter === 'all' ? payload.filter : 'all',
        nextCursor: typeof payload.nextCursor === 'string' ? payload.nextCursor : null,
        items,
        ts: typeof payload.ts === 'number' ? payload.ts : Date.now(),
      };
    } catch {
      // Ignore malformed storage payloads.
    }
  }

  return null;
}

function toMediaKind(value: string | null): Exclude<MediaKind, 'all'> {
  if (value === 'video' || value === 'file') {
    return value;
  }

  return 'image';
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

export function ViewerScreen({ mediaId }: ViewerScreenProps) {
  const router = useRouter();
  const prefersReducedMotion = useReducedMotion();
  const searchParams = useSearchParams();
  const routeKind = searchParams.get('kind');
  const fileName = searchParams.get('filename') ?? 'Media';
  const mime = searchParams.get('mime') ?? 'unknown type';

  const { getIdToken } = useAuth();

  const storedContext = useMemo(() => readStoredContext(), []);
  const [galleryItems, setGalleryItems] = useState<MediaItem[]>(storedContext?.items ?? []);
  const [activeMediaId, setActiveMediaId] = useState(mediaId);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [assetUrl, setAssetUrl] = useState<string | null>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showChrome, setShowChrome] = useState(true);
  const [showInfo, setShowInfo] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [entryTransition, setEntryTransition] = useState<ViewerTransitionPayload | null>(null);
  const [entryTransitionDone, setEntryTransitionDone] = useState(false);
  const [gestureHint, setGestureHint] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const viewerFrameRef = useRef<HTMLDivElement | null>(null);
  const currentMediaRef = useRef<HTMLImageElement | HTMLVideoElement | null>(null);
  const cacheRef = useRef<Map<string, CacheEntry>>(new Map());
  const swipeRef = useRef<SwipeState | null>(null);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const draggingRef = useRef(false);

  const currentItem = useMemo<MediaItem>(() => {
    const match = galleryItems.find((item) => item.mediaId === activeMediaId);
    if (match) {
      return match;
    }

    return {
      mediaId: activeMediaId,
      userId: '',
      channelId: 0,
      messageId: 0,
      mediaKind: toMediaKind(routeKind),
      status: 'ready',
      storageBackend: 'telegram',
      filename: fileName,
      mimeType: mime,
      thumbnailMimeType: null,
      createdAt: null,
      updatedAt: null,
    };
  }, [activeMediaId, fileName, galleryItems, mime, routeKind]);

  const currentIndex = useMemo(() => galleryItems.findIndex((item) => item.mediaId === activeMediaId), [activeMediaId, galleryItems]);
  const canGoPrevious = currentIndex > 0;
  const canGoNext = currentIndex >= 0 && currentIndex < galleryItems.length - 1;

  useEffect(() => {
    setActiveMediaId(mediaId);
  }, [mediaId]);

  useEffect(() => {
    setGalleryItems(storedContext?.items ?? []);
  }, [storedContext]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const payload: ViewerContextPayload = {
      mediaId: activeMediaId,
      index: Math.max(0, currentIndex),
      filter: storedContext?.filter ?? 'all',
      nextCursor: storedContext?.nextCursor ?? null,
      items: galleryItems,
      ts: Date.now(),
    };

    try {
      window.sessionStorage.setItem(VIEWER_CONTEXT_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage failures.
    }
  }, [activeMediaId, currentIndex, galleryItems, storedContext?.filter, storedContext?.nextCursor]);

  const releaseCache = useCallback(() => {
    for (const entry of cacheRef.current.values()) {
      if (entry.revoke) {
        URL.revokeObjectURL(entry.url);
      }
    }
    cacheRef.current.clear();
  }, []);

  const storeCacheEntry = useCallback((mediaKey: string, entry: CacheEntry) => {
    const existing = cacheRef.current.get(mediaKey);
    if (existing?.revoke) {
      URL.revokeObjectURL(existing.url);
    }

    if (cacheRef.current.has(mediaKey)) {
      cacheRef.current.delete(mediaKey);
    }

    cacheRef.current.set(mediaKey, entry);

    while (cacheRef.current.size > MAX_CACHE_ENTRIES) {
      const oldestEntry = cacheRef.current.entries().next().value as [string, CacheEntry] | undefined;
      if (!oldestEntry) {
        break;
      }

      const [oldestKey, oldestValue] = oldestEntry;
      if (oldestValue.revoke) {
        URL.revokeObjectURL(oldestValue.url);
      }
      cacheRef.current.delete(oldestKey);
    }
  }, []);

  const getCacheEntry = useCallback((mediaKey: string) => {
    const entry = cacheRef.current.get(mediaKey);
    if (!entry) {
      return null;
    }

    cacheRef.current.delete(mediaKey);
    cacheRef.current.set(mediaKey, entry);
    return entry;
  }, []);

  useEffect(() => releaseCache, [releaseCache]);

  const navigateToIndex = useCallback(
    (targetIndex: number) => {
      const target = galleryItems[targetIndex];
      if (!target) {
        return;
      }

      setDirection(targetIndex > currentIndex ? 1 : -1);
      setActiveMediaId(target.mediaId);
      setShowChrome(true);
      setShowInfo(false);
      setGestureHint(null);

      const params = new URLSearchParams();
      params.set('kind', target.mediaKind);
      if (target.filename) {
        params.set('filename', target.filename);
      }
      if (target.mimeType) {
        params.set('mime', target.mimeType);
      }

      router.replace(`/app/viewer/${target.mediaId}?${params.toString()}`);
    },
    [currentIndex, galleryItems, router],
  );

  const navigateRelative = useCallback(
    (delta: number) => {
      if (currentIndex < 0) {
        return;
      }

      navigateToIndex(currentIndex + delta);
    },
    [currentIndex, navigateToIndex],
  );

  const handleBackToGallery = useCallback(() => {
    try {
      const rect = currentMediaRef.current?.getBoundingClientRect();
      if (rect) {
        const payload: ViewerTransitionPayload = {
          mediaId: activeMediaId,
          thumbnailUrl: currentItem.mediaKind === 'video' ? null : assetUrl,
          rect: {
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          },
          ts: Date.now(),
        };

        window.sessionStorage.setItem('pixlvault.viewerReturnTransition', JSON.stringify(payload));
      }
    } catch {
      // Ignore transition persistence errors.
    }

    router.push('/app/gallery');
  }, [activeMediaId, assetUrl, currentItem.mediaKind, router]);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;

    setLoading(true);
    setError(null);
    setAssetUrl(null);
    setStreamUrl(null);
    setZoom(1);
    setOffset({ x: 0, y: 0 });

    void (async () => {
      try {
        const cached = getCacheEntry(activeMediaId);
        if (cached && cached.kind === (currentItem.mediaKind === 'video' ? 'video' : 'image')) {
          if (active) {
            if (cached.kind === 'video') {
              setStreamUrl(cached.url);
            } else {
              setAssetUrl(cached.url);
            }
          }
          return;
        }

        const token = await getIdToken();
        if (!token) {
          throw new Error('Authentication expired. Please sign in again.');
        }

        if (currentItem.mediaKind === 'video') {
          const stream = await fetchMediaStreamUrl(token, activeMediaId);
          if (!active) {
            return;
          }

          storeCacheEntry(activeMediaId, { kind: 'video', url: stream.stream_url, revoke: false });
          setStreamUrl(stream.stream_url);
          return;
        }

        const blob = await fetchMediaAssetBlob(token, activeMediaId, 'content');
        if (!active) {
          return;
        }

        objectUrl = URL.createObjectURL(blob);
        storeCacheEntry(activeMediaId, { kind: 'image', url: objectUrl, revoke: true });
        setAssetUrl(objectUrl);
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load media.');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
      if (objectUrl && !cacheRef.current.has(activeMediaId)) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [activeMediaId, currentItem.mediaKind, getIdToken]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate, streamUrl]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) {
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        if (canGoPrevious) {
          navigateRelative(-1);
        }
        return;
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        if (canGoNext) {
          navigateRelative(1);
        }
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        handleBackToGallery();
        return;
      }

      if (event.key.toLowerCase() === 'i') {
        setShowInfo((state) => !state);
        return;
      }

      if (event.key.toLowerCase() === 'h') {
        setShowChrome((state) => !state);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canGoNext, canGoPrevious, handleBackToGallery, navigateRelative]);

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem('pixlvault.viewerTransition');
      if (!raw) {
        return;
      }

      const payload = JSON.parse(raw) as ViewerTransitionPayload;
      window.sessionStorage.removeItem('pixlvault.viewerTransition');

      if (payload.mediaId !== activeMediaId) {
        return;
      }

      if (Date.now() - payload.ts > 3500) {
        return;
      }

      setEntryTransition(payload);
      setEntryTransitionDone(false);
    } catch {
      // Ignore malformed transition payloads.
    }
  }, [activeMediaId]);

  useEffect(() => {
    if (!galleryItems.length) {
      return;
    }

    let cancelled = false;

    void (async () => {
      const token = await getIdToken();
      if (!token || cancelled || currentIndex < 0) {
        return;
      }

      const neighborIndexes = [currentIndex - 1, currentIndex + 1].filter((index) => index >= 0 && index < galleryItems.length);
      for (const neighborIndex of neighborIndexes) {
        const item = galleryItems[neighborIndex];
        if (!item || cacheRef.current.has(item.mediaId)) {
          continue;
        }

        try {
          if (item.mediaKind === 'video') {
            const stream = await fetchMediaStreamUrl(token, item.mediaId);
            if (cancelled) {
              return;
            }
            storeCacheEntry(item.mediaId, { kind: 'video', url: stream.stream_url, revoke: false });
          } else {
            const blob = await fetchMediaAssetBlob(token, item.mediaId, 'content');
            if (cancelled) {
              return;
            }
            const objectUrl = URL.createObjectURL(blob);
            storeCacheEntry(item.mediaId, { kind: 'image', url: objectUrl, revoke: true });
          }
        } catch {
          // Neighbor preloading is opportunistic.
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentIndex, galleryItems, getIdToken, storeCacheEntry]);

  const onPointerDown = (event: React.PointerEvent<HTMLImageElement>) => {
    if (zoom <= 1) {
      return;
    }

    event.stopPropagation();
    draggingRef.current = true;
    dragStartRef.current = { x: event.clientX - offset.x, y: event.clientY - offset.y };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLImageElement>) => {
    if (!draggingRef.current || zoom <= 1) {
      return;
    }

    event.stopPropagation();
    setOffset({ x: event.clientX - dragStartRef.current.x, y: event.clientY - dragStartRef.current.y });
  };

  const onPointerUp = () => {
    draggingRef.current = false;
  };

  const onFramePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch' || zoom > 1) {
      return;
    }

    swipeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startedAt: Date.now(),
    };

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // ignore pointer capture failures
    }
  };

  const onFramePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!swipeRef.current || swipeRef.current.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - swipeRef.current.startX;
    const deltaY = event.clientY - swipeRef.current.startY;
    const elapsed = Date.now() - swipeRef.current.startedAt;
    swipeRef.current = null;

    if (zoom > 1 || elapsed > 900) {
      return;
    }

    if (Math.abs(deltaX) < 54 || Math.abs(deltaX) <= Math.abs(deltaY)) {
      return;
    }

    if (deltaX < 0 && canGoNext) {
      setGestureHint('Next media');
      navigateRelative(1);
    } else if (deltaX > 0 && canGoPrevious) {
      setGestureHint('Previous media');
      navigateRelative(-1);
    }

    window.setTimeout(() => setGestureHint(null), 900);
  };

  const loadProgressLabel = loading ? 'Loading media…' : null;

  const motionKey = activeMediaId;

  return (
    <main className="fixed inset-0 z-50 overflow-hidden bg-[radial-gradient(circle_at_top,rgba(60,130,110,0.22),transparent_36%),radial-gradient(circle_at_bottom,rgba(50,65,120,0.2),transparent_46%),#020307] text-white">
      <AnimatePresence>
        {showChrome ? (
          <M.header
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute inset-x-0 top-0 z-20 border-b border-white/10 bg-black/35 px-4 py-3 backdrop-blur sm:px-6"
          >
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleBackToGallery}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/85 transition hover:bg-white/10"
                aria-label="Back to gallery"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>

              <div className="min-w-0 text-center">
                <p className="max-w-[45vw] truncate text-sm text-white/70">{currentItem.filename ?? fileName}</p>
                <p className="text-[11px] uppercase tracking-[0.24em] text-white/40">
                  {galleryItems.length ? `${Math.max(1, currentIndex + 1)} of ${galleryItems.length}` : 'Single item view'}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowInfo((state) => !state)}
                aria-pressed={showInfo}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/85 transition hover:bg-white/10"
              >
                <Info className="h-4 w-4" />
                Info
              </button>
            </div>
          </M.header>
        ) : null}
      </AnimatePresence>

      <div
        className="absolute inset-0 flex items-center justify-center px-3 pb-24 pt-16 sm:px-8 sm:pb-20 sm:pt-20"
        onClick={() => setShowChrome((state) => !state)}
        onPointerDown={onFramePointerDown}
        onPointerUp={onFramePointerUp}
        onPointerCancel={() => {
          swipeRef.current = null;
        }}
      >
        <AnimatePresence mode="wait" initial={false} custom={direction}>
          {loading ? (
            <M.div
              key="viewer-loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="inline-flex items-center gap-2 text-white/70"
              role="status"
              aria-live="polite"
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              {loadProgressLabel}
            </M.div>
          ) : error ? (
            <M.div
              key="viewer-error"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="rounded-2xl border border-rose-400/20 bg-rose-500/10 p-4 text-sm text-rose-100"
            >
              {error}
            </M.div>
          ) : (
            <M.div
              key={motionKey}
              custom={direction}
              initial={prefersReducedMotion ? { opacity: 0.96 } : { opacity: 0, x: direction > 0 ? 48 : -48, scale: 0.985 }}
              animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, x: 0, scale: 1 }}
              exit={prefersReducedMotion ? { opacity: 0.96 } : { opacity: 0, x: direction > 0 ? -48 : 48, scale: 0.985 }}
              transition={{ duration: prefersReducedMotion ? 0.01 : 0.28, ease: [0.2, 0.78, 0.2, 1] }}
              className="relative w-full max-w-6xl"
              ref={viewerFrameRef}
              onClick={(event: React.MouseEvent) => event.stopPropagation()}
            >
              {currentItem.mediaKind === 'video' && streamUrl ? (
                <video
                  ref={(node) => {
                    videoRef.current = node;
                    currentMediaRef.current = node;
                  }}
                  src={streamUrl}
                  controls
                  autoPlay
                  playsInline
                  preload="metadata"
                  className="max-h-[84vh] w-full rounded-2xl border border-white/10 bg-black/60 object-contain shadow-2xl"
                  aria-label={currentItem.filename ?? fileName}
                />
              ) : assetUrl ? (
                <img
                  ref={(node) => {
                    currentMediaRef.current = node;
                  }}
                  src={assetUrl}
                  alt={currentItem.filename ?? fileName}
                  onDoubleClick={() => setZoom((current) => (current === 1 ? 2 : 1))}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerLeave={onPointerUp}
                  loading="eager"
                  decoding="async"
                  className="max-h-[84vh] w-full rounded-2xl border border-white/10 bg-black/55 object-contain shadow-2xl"
                  style={{
                    transform: `scale(${zoom}) translate(${offset.x / (zoom * 10)}px, ${offset.y / (zoom * 10)}px)`,
                    cursor: zoom > 1 ? 'grab' : 'zoom-in',
                  }}
                />
              ) : null}
            </M.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {!loading && currentItem.mediaKind !== 'video' && entryTransition && !entryTransitionDone ? (
          <M.img
            key="viewer-entry-transition"
            src={entryTransition.thumbnailUrl ?? assetUrl ?? undefined}
            alt={currentItem.filename ?? fileName}
            initial={{
              opacity: 1,
              top: entryTransition.rect.top,
              left: entryTransition.rect.left,
              width: entryTransition.rect.width,
              height: entryTransition.rect.height,
              borderRadius: 24,
            }}
            animate={{
              opacity: 0,
              top: '12vh',
              left: '8vw',
              width: '84vw',
              height: '76vh',
              borderRadius: 20,
              transition: {
                duration: prefersReducedMotion ? 0.01 : 0.34,
                ease: [0.2, 0.78, 0.2, 1],
              },
            }}
            exit={{ opacity: 0 }}
            onAnimationComplete={() => setEntryTransitionDone(true)}
            className="pointer-events-none fixed z-30 object-cover shadow-2xl"
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {showInfo ? (
          <M.aside
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="absolute bottom-20 right-3 z-20 w-[min(92vw,340px)] rounded-2xl border border-white/10 bg-black/50 p-4 text-sm backdrop-blur sm:bottom-6 sm:right-6"
          >
            <p className="text-xs uppercase tracking-[0.24em] text-white/45">Details</p>
            <p className="mt-2 truncate text-white">{currentItem.filename ?? fileName}</p>
            <p className="mt-1 text-white/65">{currentItem.mediaKind}</p>
            <p className="mt-1 truncate text-white/55">{currentItem.mimeType ?? mime}</p>
            <p className="mt-3 text-xs text-white/45">Arrow keys, swipe left/right, or tap the edges to navigate.</p>
            <p className="mt-1 text-xs text-white/45">I toggles info, H hides chrome, Escape returns to gallery.</p>
          </M.aside>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {gestureHint ? (
          <M.div
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            className="pointer-events-none absolute left-1/2 top-20 z-30 -translate-x-1/2 rounded-full border border-white/10 bg-black/55 px-4 py-2 text-sm text-white/85 backdrop-blur"
          >
            {gestureHint}
          </M.div>
        ) : null}
      </AnimatePresence>

      <button
        type="button"
        onClick={() => navigateRelative(-1)}
        disabled={!canGoPrevious}
        aria-label="Previous media"
        className="absolute left-3 top-1/2 z-20 hidden -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/40 p-3 text-white/85 backdrop-blur transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30 md:inline-flex"
      >
        <ArrowLeftCircle className="h-7 w-7" />
      </button>
      <button
        type="button"
        onClick={() => navigateRelative(1)}
        disabled={!canGoNext}
        aria-label="Next media"
        className="absolute right-3 top-1/2 z-20 hidden -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/40 p-3 text-white/85 backdrop-blur transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30 md:inline-flex"
      >
        <ArrowRightCircle className="h-7 w-7" />
      </button>

      <div className="absolute inset-x-0 bottom-0 z-20 flex justify-center px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:pb-6">
        <div className="flex w-full max-w-[860px] flex-wrap items-center justify-center gap-2 rounded-2xl border border-white/10 bg-black/45 p-2 backdrop-blur">
          <button
            type="button"
            onClick={() => navigateRelative(-1)}
            disabled={!canGoPrevious}
            className="inline-flex min-h-10 items-center gap-1 rounded-xl border border-white/10 px-3 py-1.5 text-xs uppercase tracking-[0.18em] text-white/70 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35 md:hidden"
          >
            <ArrowLeftCircle className="h-3.5 w-3.5" />
            Prev
          </button>
          <button
            type="button"
            onClick={() => navigateRelative(1)}
            disabled={!canGoNext}
            className="inline-flex min-h-10 items-center gap-1 rounded-xl border border-white/10 px-3 py-1.5 text-xs uppercase tracking-[0.18em] text-white/70 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35 md:hidden"
          >
            Next
            <ArrowRightCircle className="h-3.5 w-3.5" />
          </button>

          {currentItem.mediaKind === 'video' ? (
            <>
              <label htmlFor="viewer-playback-speed" className="px-2 text-xs uppercase tracking-[0.18em] text-white/60">
                Speed
              </label>
              <select
                id="viewer-playback-speed"
                value={String(playbackRate)}
                onChange={(event) => setPlaybackRate(Number(event.target.value))}
                className="rounded-lg border border-white/10 bg-black/50 px-2 py-1 text-sm text-white"
              >
                <option value="0.5">0.5x</option>
                <option value="1">1x</option>
                <option value="1.5">1.5x</option>
                <option value="2">2x</option>
              </select>
              <button
                type="button"
                onClick={async () => {
                  const video = videoRef.current;
                  if (!video || !('requestPictureInPicture' in video)) {
                    return;
                  }
                  try {
                    if ((document as any).pictureInPictureElement === video) {
                      await (document as any).exitPictureInPicture();
                    } else {
                      await (video as any).requestPictureInPicture();
                    }
                  } catch {
                    // ignore browser-specific PiP errors
                  }
                }}
                aria-label="Toggle picture in picture"
                className="inline-flex min-h-10 items-center gap-1 rounded-xl border border-white/10 px-3 py-1.5 text-xs uppercase tracking-[0.18em] text-white/70 transition hover:bg-white/10"
              >
                <PictureInPicture2 className="h-3.5 w-3.5" />
                PiP
              </button>
              <button
                type="button"
                onClick={async () => {
                  const frame = viewerFrameRef.current;
                  if (!frame) {
                    return;
                  }
                  try {
                    if (document.fullscreenElement) {
                      await document.exitFullscreen();
                    } else {
                      await frame.requestFullscreen();
                    }
                  } catch {
                    // ignore browser-specific fullscreen errors
                  }
                }}
                aria-label="Toggle fullscreen"
                className="inline-flex min-h-10 items-center gap-1 rounded-xl border border-white/10 px-3 py-1.5 text-xs uppercase tracking-[0.18em] text-white/70 transition hover:bg-white/10"
              >
                <Maximize2 className="h-3.5 w-3.5" />
                Fullscreen
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setZoom((current) => Math.min(3, Number((current + 0.25).toFixed(2))))}
                aria-label="Zoom in image"
                className="inline-flex min-h-10 items-center gap-1 rounded-xl border border-white/10 px-3 py-1.5 text-xs uppercase tracking-[0.18em] text-white/70 transition hover:bg-white/10"
              >
                <ZoomIn className="h-3.5 w-3.5" />
                Zoom in
              </button>
              <button
                type="button"
                onClick={() => setZoom((current) => Math.max(1, Number((current - 0.25).toFixed(2))))}
                aria-label="Zoom out image"
                className="inline-flex min-h-10 items-center gap-1 rounded-xl border border-white/10 px-3 py-1.5 text-xs uppercase tracking-[0.18em] text-white/70 transition hover:bg-white/10"
              >
                <ZoomOut className="h-3.5 w-3.5" />
                Zoom out
              </button>
              <button
                type="button"
                onClick={() => {
                  setZoom(1);
                  setOffset({ x: 0, y: 0 });
                }}
                aria-label="Reset image zoom"
                className="inline-flex min-h-10 items-center gap-1 rounded-xl border border-white/10 px-3 py-1.5 text-xs uppercase tracking-[0.18em] text-white/70 transition hover:bg-white/10"
              >
                <Minimize2 className="h-3.5 w-3.5" />
                Reset
              </button>
              {assetUrl ? (
                <a
                  href={assetUrl}
                  download={currentItem.filename ?? fileName}
                  aria-label="Download media"
                  className="inline-flex min-h-10 items-center gap-1 rounded-xl border border-white/10 px-3 py-1.5 text-xs uppercase tracking-[0.18em] text-white/70 transition hover:bg-white/10"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download
                </a>
              ) : null}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
