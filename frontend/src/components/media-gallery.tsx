"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { Film, FileImage, FileText, Loader2, PlayCircle } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { useRouter } from 'next/navigation';

import { fetchMediaAssetBlob, listMedia } from '@/lib/api';
import type { MediaItem, MediaKind } from '@/lib/types';

const M: any = motion;
const PAGE_SIZE = 24;

const FILTERS: Array<{ value: MediaKind; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'image', label: 'Images' },
  { value: 'video', label: 'Videos' },
  { value: 'file', label: 'Files' },
];

type MediaGalleryProps = {
  idToken: string;
  refreshKey: number;
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

type ViewerReturnTransitionPayload = {
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

type ReturnOverlay = {
  thumbnailUrl: string | null;
  fromRect: ViewerReturnTransitionPayload['rect'];
  toRect: ViewerReturnTransitionPayload['rect'];
};

function readStoredGalleryContext(): GalleryContextPayload | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem('pixlvault.galleryContext');
    if (!raw) {
      return null;
    }

    const payload = JSON.parse(raw) as GalleryContextPayload;
    if (!payload || !Array.isArray(payload.items)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export function MediaGallery({ idToken, refreshKey }: MediaGalleryProps) {
  const router = useRouter();
  const prefersReducedMotion = useReducedMotion();
  const initialStoredContextRef = useRef<GalleryContextPayload | null>(readStoredGalleryContext());
  const [items, setItems] = useState<MediaItem[]>(initialStoredContextRef.current?.items ?? []);
  const [nextCursor, setNextCursor] = useState<string | null>(initialStoredContextRef.current?.nextCursor ?? null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<MediaKind>(initialStoredContextRef.current?.filter ?? 'all');
  const [returnOverlay, setReturnOverlay] = useState<ReturnOverlay | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const tileRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const payload: GalleryContextPayload = {
      filter,
      nextCursor,
      items,
      ts: Date.now(),
    };

    try {
      window.sessionStorage.setItem('pixlvault.galleryContext', JSON.stringify(payload));
    } catch {
      // Ignore session storage failures.
    }
  }, [filter, items, nextCursor]);

  useEffect(() => {
    if (!idToken) {
      setItems([]);
      setNextCursor(null);
      setLoading(false);
      return;
    }

    const restoredContext = initialStoredContextRef.current;
    if (restoredContext?.items?.length && restoredContext.filter === filter && refreshKey === 0) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    const loadFirstPage = async () => {
      setLoading(true);
      setError(null);

      try {
        const page = await listMedia(idToken, { limit: PAGE_SIZE, kind: filter });
        if (cancelled) {
          return;
        }

        setItems(page.items ?? []);
        setNextCursor(page.nextCursor ?? null);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load gallery.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadFirstPage();

    return () => {
      cancelled = true;
    };
  }, [filter, idToken, refreshKey]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !nextCursor || !idToken || loading || loadingMore) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting) || loadingMore || !nextCursor) {
          return;
        }

        setLoadingMore(true);

        void (async () => {
          try {
            const page = await listMedia(idToken, { limit: PAGE_SIZE, kind: filter, cursor: nextCursor });
            setItems((current) => [...current, ...(page.items ?? [])]);
            setNextCursor(page.nextCursor ?? null);
          } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : 'Failed to load more media.');
          } finally {
            setLoadingMore(false);
          }
        })();
      },
      { rootMargin: '540px 0px' },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [filter, idToken, loading, loadingMore, nextCursor]);

  const mediaTotals = useMemo(() => {
    return items.reduce(
      (acc, item) => {
        acc.total += 1;
        acc[item.mediaKind] += 1;
        return acc;
      },
      { total: 0, image: 0, video: 0, file: 0 },
    );
  }, [items]);

  const openViewer = (payload: { item: MediaItem; thumbnailUrl: string | null; rect: DOMRect; index: number }) => {
    const transitionPayload: ViewerTransitionPayload = {
      mediaId: payload.item.mediaId,
      thumbnailUrl: payload.thumbnailUrl,
      rect: {
        top: payload.rect.top,
        left: payload.rect.left,
        width: payload.rect.width,
        height: payload.rect.height,
      },
      ts: Date.now(),
    };

    try {
      window.sessionStorage.setItem('pixlvault.viewerTransition', JSON.stringify(transitionPayload));
      window.sessionStorage.setItem(
        'pixlvault.viewerContext',
        JSON.stringify({
          mediaId: payload.item.mediaId,
          index: payload.index,
          filter,
          nextCursor,
          items,
          ts: Date.now(),
        }),
      );
    } catch {
      // Ignore storage failures and continue navigation.
    }

    const params = new URLSearchParams();
    params.set('kind', payload.item.mediaKind);
    if (payload.item.filename) {
      params.set('filename', payload.item.filename);
    }
    if (payload.item.mimeType) {
      params.set('mime', payload.item.mimeType);
    }
    router.push(`/app/viewer/${payload.item.mediaId}?${params.toString()}`);
  };

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem('pixlvault.viewerReturnTransition');
      if (!raw) {
        return;
      }

      const payload = JSON.parse(raw) as ViewerReturnTransitionPayload;
      window.sessionStorage.removeItem('pixlvault.viewerReturnTransition');

      if (Date.now() - payload.ts > 4000 || !payload.thumbnailUrl) {
        return;
      }

      requestAnimationFrame(() => {
        const target = tileRefs.current[payload.mediaId];
        if (!target) {
          return;
        }

        const rect = target.getBoundingClientRect();
        setReturnOverlay({
          thumbnailUrl: payload.thumbnailUrl,
          fromRect: payload.rect,
          toRect: {
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          },
        });
      });
    } catch {
      // Ignore malformed payloads.
    }
  }, [items]);

  return (
    <section className="space-y-5">
      <div className="rounded-[30px] border border-white/10 bg-white/5 p-4 shadow-glow backdrop-blur sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-white/45">Gallery</p>
            <h2 className="mt-1 font-[family-name:var(--font-space-grotesk)] text-2xl font-semibold tracking-tight sm:text-3xl">Your private media universe</h2>
          </div>
          <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.24em] text-white/55">
            {mediaTotals.total} items
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {FILTERS.map((entry) => (
            <button
              key={entry.value}
              type="button"
              onClick={() => setFilter(entry.value)}
              aria-pressed={filter === entry.value}
              className={`rounded-full border px-4 py-2 text-sm transition ${
                filter === entry.value
                  ? 'border-accent-300/40 bg-accent-400/20 text-accent-100'
                  : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10'
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-2 text-xs uppercase tracking-[0.2em] text-white/50 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/8 bg-black/20 px-3 py-2">{mediaTotals.image} images</div>
          <div className="rounded-2xl border border-white/8 bg-black/20 px-3 py-2">{mediaTotals.video} videos</div>
          <div className="rounded-2xl border border-white/8 bg-black/20 px-3 py-2">{mediaTotals.file} files</div>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((index) => (
            <div key={index} className="overflow-hidden rounded-3xl border border-white/8 bg-black/20 p-3">
              <div className={`rounded-2xl bg-[linear-gradient(135deg,rgba(75,217,172,0.18),rgba(126,96,255,0.12))] ${index % 3 === 0 ? 'aspect-[3/4]' : 'aspect-[4/3]'}`} />
              <div className="mt-3 h-2 w-3/4 rounded-full bg-white/10" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="rounded-3xl border border-rose-400/20 bg-rose-500/10 p-5 text-sm text-rose-100">{error}</div>
      ) : items.length === 0 ? (
        <div className="rounded-3xl border border-white/8 bg-black/15 p-8 text-sm text-white/60">No media uploaded yet.</div>
      ) : (
        <M.div
          initial={prefersReducedMotion ? false : 'hidden'}
          animate="show"
          variants={prefersReducedMotion ? {} : {
            hidden: { opacity: 0 },
            show: {
              opacity: 1,
              transition: { staggerChildren: 0.04 },
            },
          }}
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
        >
          {items.map((item, index) => (
            <MediaTile
              key={item.mediaId}
              item={item}
              token={idToken}
              index={index}
              reduceMotion={Boolean(prefersReducedMotion)}
              registerRef={(node) => {
                tileRefs.current[item.mediaId] = node;
              }}
              onOpen={(tileState) => openViewer({ item, index, ...tileState })}
            />
          ))}
        </M.div>
      )}

      <div ref={sentinelRef} className="py-4 text-center text-sm text-white/45" role="status" aria-live="polite">
        {loadingMore ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading more media
          </span>
        ) : nextCursor ? (
          'Scroll for more'
        ) : (
          'You reached the end'
        )}
      </div>

      {returnOverlay ? (
        <M.img
          src={returnOverlay.thumbnailUrl ?? undefined}
          alt=""
          aria-hidden="true"
          initial={{
            top: returnOverlay.fromRect.top,
            left: returnOverlay.fromRect.left,
            width: returnOverlay.fromRect.width,
            height: returnOverlay.fromRect.height,
            opacity: 0.98,
            borderRadius: 20,
          }}
          animate={{
            top: returnOverlay.toRect.top,
            left: returnOverlay.toRect.left,
            width: returnOverlay.toRect.width,
            height: returnOverlay.toRect.height,
            opacity: 0,
            borderRadius: 24,
            transition: {
              duration: prefersReducedMotion ? 0.01 : 0.3,
              ease: [0.2, 0.78, 0.2, 1],
            },
          }}
          onAnimationComplete={() => setReturnOverlay(null)}
          className="pointer-events-none fixed z-50 object-cover shadow-2xl"
        />
      ) : null}
    </section>
  );
}

function MediaTile({
  item,
  token,
  index,
  registerRef,
  onOpen,
  reduceMotion,
}: {
  item: MediaItem;
  token: string;
  index: number;
  registerRef: (node: HTMLButtonElement | null) => void;
  onOpen: (value: { thumbnailUrl: string | null; rect: DOMRect }) => void;
  reduceMotion: boolean;
}) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const tileRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const tile = tileRef.current;
    if (!tile) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '280px' },
    );

    observer.observe(tile);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isVisible || thumbnailUrl) {
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    void (async () => {
      try {
        const blob = await fetchMediaAssetBlob(token, item.mediaId, 'thumbnail');
        if (cancelled) {
          return;
        }

        objectUrl = URL.createObjectURL(blob);
        setThumbnailUrl(objectUrl);
      } catch {
        if (!cancelled) {
          setThumbnailUrl(null);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [isVisible, item.mediaId, thumbnailUrl, token]);

  const Icon = item.mediaKind === 'image' ? FileImage : item.mediaKind === 'video' ? Film : FileText;
  const isTall = index % 5 === 0 || index % 7 === 0;

  return (
    <M.button
      ref={(node: HTMLButtonElement | null) => {
        tileRef.current = node;
        registerRef(node);
      }}
      type="button"
      aria-label={`Open ${item.filename ?? 'media'} viewer`}
      onClick={(event: React.MouseEvent<HTMLButtonElement>) => onOpen({ thumbnailUrl, rect: event.currentTarget.getBoundingClientRect() })}
      variants={reduceMotion ? {} : { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0 } }}
      whileHover={reduceMotion ? undefined : { y: -4, scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      className="group overflow-hidden rounded-3xl border border-white/8 bg-white/5 text-left shadow-[0_20px_70px_rgba(0,0,0,0.28)] backdrop-blur transition duration-300 hover:-translate-y-1 hover:border-white/20"
    >
      <div className={`relative overflow-hidden ${isTall ? 'aspect-[3/4]' : 'aspect-[4/3]'}`}>
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt={item.filename ?? 'Media thumbnail'} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]" loading="lazy" decoding="async" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_top_right,rgba(75,217,172,0.2),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(126,96,255,0.18),transparent_38%)]">
            <Icon className="h-10 w-10 text-white/70" />
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/10" />

        <div className="absolute left-3 top-3 rounded-full border border-white/15 bg-black/30 p-2 text-white/80 backdrop-blur">
          <Icon className="h-4 w-4" />
        </div>

        {item.mediaKind === 'video' ? (
          <div className="absolute right-3 top-3 rounded-full border border-white/15 bg-black/35 p-2 text-white/90 backdrop-blur">
            <PlayCircle className="h-4 w-4" />
          </div>
        ) : null}

        <div className="absolute inset-x-3 bottom-3">
          <p className="truncate text-sm font-medium text-white">{item.filename ?? 'Untitled media'}</p>
          <p className="mt-0.5 truncate text-xs text-white/70">{item.mimeType ?? 'unknown type'}</p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 px-3 py-2.5 text-xs text-white/60">
        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 uppercase tracking-[0.16em]">{item.mediaKind}</span>
        {item.status !== 'ready' ? (
          <span className="rounded-full border border-amber-300/30 bg-amber-400/10 px-2 py-1 uppercase tracking-[0.14em] text-amber-100">
            {item.status === 'unavailable' ? 'Unavailable' : item.status}
          </span>
        ) : null}
        <span>{Math.max(1, Math.round((item.originalSizeBytes ?? 0) / 1024))} KB</span>
      </div>
      {item.status !== 'ready' && item.availabilityReason ? (
        <div className="px-3 pb-3 text-[11px] leading-5 text-amber-100/80">{item.availabilityReason}</div>
      ) : null}
    </M.button>
  );
}
