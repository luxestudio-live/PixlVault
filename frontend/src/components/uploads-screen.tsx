"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowUpFromLine, CheckCircle2, CircleAlert, FileImage, FileText, Film, Loader2, RefreshCcw, Trash2, Upload } from 'lucide-react';

import { useAuth } from '@/components/auth-provider';
import { createMediaUpload } from '@/lib/api';
import type { MediaItem } from '@/lib/types';

const M: any = motion;
const CONCURRENCY_OPTIONS = [1, 2, 3] as const;
const RECOMMENDED_BATCH_TEXT = 'Recommended: 10-20 files per batch';
const MAX_FILES_PER_ADD = 20;
const MAX_QUEUE_SIZE = 60;
const MAX_FILE_SIZE_MB = 50;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const SUPPORTED_TYPE_LABEL = 'Supported: images, videos, PDF, plain text, CSV, ZIP, JSON';

const ALLOWED_MIME_PREFIXES = ['image/', 'video/', 'text/'];
const ALLOWED_EXACT_MIME_TYPES = new Set([
  'application/pdf',
  'application/json',
  'application/zip',
  'application/x-zip-compressed',
  'text/csv',
]);
const ALLOWED_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'webp', 'gif',
  'mp4', 'mov', 'mkv', 'webm',
  'pdf', 'txt', 'csv', 'zip', 'json',
]);

type UploadStatus = 'queued' | 'uploading' | 'success' | 'failed' | 'cancelled';

type UploadQueueItem = {
  id: string;
  file: File;
  previewUrl: string | null;
  previewKind: 'image' | 'video' | 'file';
  status: UploadStatus;
  progress: number;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  transferLabel: string | null;
  etaLabel: string | null;
  attemptId: string | null;
  mediaId: string | null;
  media: MediaItem | null;
};

type RunningUpload = {
  cancel: () => void;
  attemptId: string;
};

function getPreviewKind(file: File): UploadQueueItem['previewKind'] {
  if (file.type.startsWith('image/')) {
    return 'image';
  }

  if (file.type.startsWith('video/')) {
    return 'video';
  }

  return 'file';
}

function makeUploadId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatSpeed(bytesPerSecond: number | null) {
  if (!bytesPerSecond || !Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
    return 'Calculating speed';
  }

  if (bytesPerSecond < 1024) {
    return `${bytesPerSecond.toFixed(0)} B/s`;
  }

  if (bytesPerSecond < 1024 * 1024) {
    return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  }

  return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return 'less than 1s';
  }

  const rounded = Math.ceil(seconds);
  if (rounded < 60) {
    return `${rounded}s`;
  }

  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function getStatusLabel(status: UploadStatus) {
  switch (status) {
    case 'queued':
      return 'Queued';
    case 'uploading':
      return 'Uploading';
    case 'success':
      return 'Uploaded';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
  }
}

function getStatusTone(status: UploadStatus) {
  switch (status) {
    case 'queued':
      return 'border-white/10 bg-white/5 text-white/65';
    case 'uploading':
      return 'border-accent-300/30 bg-accent-400/10 text-accent-50';
    case 'success':
      return 'border-emerald-400/30 bg-emerald-500/10 text-emerald-50';
    case 'failed':
      return 'border-rose-400/30 bg-rose-500/10 text-rose-50';
    case 'cancelled':
      return 'border-white/10 bg-white/5 text-white/55';
  }
}

function makeQueueItem(file: File): UploadQueueItem {
  const previewKind = getPreviewKind(file);
  const previewUrl = previewKind === 'file' ? null : URL.createObjectURL(file);

  return {
    id: makeUploadId(),
    file,
    previewUrl,
    previewKind,
    status: 'queued',
    progress: 0,
    error: null,
    startedAt: null,
    finishedAt: null,
    transferLabel: 'Waiting in queue',
    etaLabel: null,
    attemptId: null,
    mediaId: null,
    media: null,
  };
}

function isSupportedFile(file: File): boolean {
  const mime = file.type.toLowerCase();
  if (mime && (ALLOWED_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix)) || ALLOWED_EXACT_MIME_TYPES.has(mime))) {
    return true;
  }

  const extension = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() : '';
  return Boolean(extension && ALLOWED_EXTENSIONS.has(extension));
}

function createQueueStateMessage(stats: { queued: number; uploading: number; success: number; failed: number; cancelled: number }) {
  if (stats.uploading > 0) {
    return `${stats.uploading} uploading, ${stats.queued} queued`;
  }

  if (stats.success > 0 && stats.queued === 0 && stats.failed === 0) {
    return 'All uploads complete. Media is in your gallery.';
  }

  if (stats.failed > 0) {
    return `${stats.failed} upload${stats.failed === 1 ? '' : 's'} need attention.`;
  }

  if (stats.cancelled > 0) {
    return `${stats.cancelled} upload${stats.cancelled === 1 ? '' : 's'} cancelled.`;
  }

  return 'Drop media here or pick files to build your upload queue.';
}

export function UploadsScreen() {
  const { getIdToken } = useAuth();
  const prefersReducedMotion = useReducedMotion();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const itemsRef = useRef<UploadQueueItem[]>([]);
  const runningUploadsRef = useRef<Map<string, RunningUpload>>(new Map());
  const launchGuardRef = useRef<Set<string>>(new Set());
  const dragDepthRef = useRef(0);

  const [uploadItems, setUploadItems] = useState<UploadQueueItem[]>([]);
  const [concurrencyLimit, setConcurrencyLimit] = useState<(typeof CONCURRENCY_OPTIONS)[number]>(2);
  const [message, setMessage] = useState<string>('Drop media here or pick files to build your upload queue.');
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    itemsRef.current = uploadItems;
  }, [uploadItems]);

  useEffect(() => {
    return () => {
      for (const item of itemsRef.current) {
        if (item.previewUrl) {
          URL.revokeObjectURL(item.previewUrl);
        }
      }
    };
  }, []);

  const stats = useMemo(() => {
    return uploadItems.reduce(
      (acc, item) => {
        acc.total += 1;
        acc[item.status] += 1;
        return acc;
      },
      { total: 0, queued: 0, uploading: 0, success: 0, failed: 0, cancelled: 0 },
    );
  }, [uploadItems]);

  const queueSummary = useMemo(() => createQueueStateMessage(stats), [stats]);

  const addFiles = useCallback((files: File[]) => {
    if (!files.length) {
      return;
    }

    setUploadItems((current) => {
      const availableSlots = Math.max(0, MAX_QUEUE_SIZE - current.length);
      if (availableSlots <= 0) {
        setMessage(`Queue limit reached (${MAX_QUEUE_SIZE}). Clear finished items before adding more.`);
        return current;
      }

      const intake = files.slice(0, Math.min(MAX_FILES_PER_ADD, availableSlots));
      const skippedCountByBatch = Math.max(0, files.length - intake.length);
      const accepted: File[] = [];
      const rejectedReasons: string[] = [];

      for (const file of intake) {
        if (file.size > MAX_FILE_SIZE_BYTES) {
          rejectedReasons.push(`${file.name}: exceeds ${MAX_FILE_SIZE_MB} MB`);
          continue;
        }

        if (!isSupportedFile(file)) {
          rejectedReasons.push(`${file.name}: unsupported format`);
          continue;
        }

        accepted.push(file);
      }

      const nextQueue = accepted.length ? [...current, ...accepted.map(makeQueueItem)] : current;
      const details: string[] = [];
      if (accepted.length) {
        details.push(`${accepted.length} file${accepted.length === 1 ? '' : 's'} queued.`);
      }
      if (rejectedReasons.length) {
        const sample = rejectedReasons.slice(0, 3).join(' | ');
        const more = rejectedReasons.length > 3 ? ` (+${rejectedReasons.length - 3} more)` : '';
        details.push(`Skipped ${rejectedReasons.length}: ${sample}${more}.`);
      }
      if (skippedCountByBatch > 0) {
        details.push(`Only the first ${MAX_FILES_PER_ADD} files are accepted per add.`);
      }

      setMessage(details.join(' ') || 'No valid files were added.');
      return nextQueue;
    });
  }, []);

  const removeItem = useCallback((itemId: string) => {
    const running = runningUploadsRef.current.get(itemId);
    if (running) {
      running.cancel();
      runningUploadsRef.current.delete(itemId);
    }

    setUploadItems((current) => {
      const target = current.find((item) => item.id === itemId);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return current.filter((item) => item.id !== itemId);
    });
  }, []);

  const updateItem = useCallback((itemId: string, updater: (item: UploadQueueItem) => UploadQueueItem) => {
    setUploadItems((current) => current.map((item) => (item.id === itemId ? updater(item) : item)));
  }, []);

  const cancelUpload = useCallback((itemId: string) => {
    const running = runningUploadsRef.current.get(itemId);
    if (running) {
      running.cancel();
    }

    updateItem(itemId, (item) => ({
      ...item,
      status: 'cancelled',
      progress: item.status === 'uploading' ? item.progress : 0,
      error: 'Cancelled by you.',
      finishedAt: Date.now(),
      transferLabel: 'Cancelled',
      etaLabel: null,
    }));
  }, [updateItem]);

  const retryUpload = useCallback((itemId: string) => {
    updateItem(itemId, (item) => ({
      ...item,
      status: 'queued',
      progress: 0,
      error: null,
      startedAt: null,
      finishedAt: null,
      transferLabel: 'Waiting in queue',
      etaLabel: null,
      attemptId: null,
      mediaId: null,
      media: null,
    }));
    setMessage('Retrying failed upload.');
  }, [updateItem]);

  const clearFinished = useCallback(() => {
    setUploadItems((current) => {
      const retained: UploadQueueItem[] = [];
      for (const item of current) {
        if (item.status === 'success' || item.status === 'failed' || item.status === 'cancelled') {
          if (item.previewUrl) {
            URL.revokeObjectURL(item.previewUrl);
          }
          continue;
        }
        retained.push(item);
      }
      return retained;
    });
  }, []);

  const startUpload = useCallback(
    async (itemId: string) => {
      if (launchGuardRef.current.has(itemId) || runningUploadsRef.current.has(itemId)) {
        return;
      }

      const snapshot = itemsRef.current.find((item) => item.id === itemId);
      if (!snapshot || snapshot.status !== 'queued') {
        return;
      }

      launchGuardRef.current.add(itemId);
      try {
        const token = await getIdToken();
        if (!token) {
          updateItem(itemId, (item) => ({
            ...item,
            status: 'failed',
            error: 'Authentication is required to upload media.',
            finishedAt: Date.now(),
            transferLabel: 'Failed',
            etaLabel: null,
          }));
          return;
        }

        const latest = itemsRef.current.find((item) => item.id === itemId);
        if (!latest || latest.status !== 'queued') {
          return;
        }

        const attemptId = makeUploadId();
        const startedAt = Date.now();
        const upload = createMediaUpload(token, latest.file, (progress) => {
          const activeItem = itemsRef.current.find((item) => item.id === itemId);
          if (!activeItem || activeItem.attemptId !== attemptId || activeItem.status !== 'uploading') {
            return;
          }

          const loadedBytes = Math.round((progress / 100) * latest.file.size);
          const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
          const speedBytesPerSecond = loadedBytes / elapsedSeconds;
          const remainingBytes = Math.max(0, latest.file.size - loadedBytes);
          const etaSeconds = speedBytesPerSecond > 0 ? remainingBytes / speedBytesPerSecond : null;

          updateItem(itemId, (item) => {
            if (item.attemptId !== attemptId || item.status !== 'uploading') {
              return item;
            }

            return {
              ...item,
              progress,
              transferLabel: formatSpeed(speedBytesPerSecond),
              etaLabel: etaSeconds === null ? null : `${formatDuration(etaSeconds)} left`,
            };
          });
        });

        runningUploadsRef.current.set(itemId, { cancel: upload.cancel, attemptId });

        updateItem(itemId, (item) => ({
          ...item,
          status: 'uploading',
          progress: 0,
          error: null,
          startedAt,
          finishedAt: null,
          transferLabel: 'Preparing upload…',
          etaLabel: null,
          attemptId,
        }));

        const media = await upload.promise;
        updateItem(itemId, (item) => {
          if (item.attemptId !== attemptId) {
            return item;
          }

          return {
            ...item,
            status: 'success',
            progress: 100,
            error: null,
            finishedAt: Date.now(),
            transferLabel: 'Uploaded successfully',
            etaLabel: null,
            mediaId: media.mediaId,
            media,
          };
        });
        try {
          window.sessionStorage.setItem('pixlvault.galleryRefreshAfter', String(Date.now() + 1200));
        } catch {
          // Ignore session storage failures.
        }
        setMessage(`${latest.file.name} uploaded to your gallery.`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Upload failed.';
        const cancelled = errorMessage.toLowerCase().includes('cancel');

        updateItem(itemId, (item) => {
          if (item.status !== 'uploading' && item.status !== 'queued') {
            return item;
          }

          return {
            ...item,
            status: cancelled ? 'cancelled' : 'failed',
            error: cancelled ? 'Cancelled by you.' : errorMessage,
            finishedAt: Date.now(),
            transferLabel: cancelled ? 'Cancelled' : 'Upload failed',
            etaLabel: null,
          };
        });

        if (!cancelled) {
          setMessage(errorMessage);
        }
      } finally {
        runningUploadsRef.current.delete(itemId);
        launchGuardRef.current.delete(itemId);
      }
    },
    [getIdToken, updateItem],
  );

  useEffect(() => {
    const activeCount = uploadItems.filter((item) => item.status === 'uploading').length;
    const availableSlots = concurrencyLimit - activeCount;
    if (availableSlots <= 0) {
      return;
    }

    const nextQueued = uploadItems.filter((item) => item.status === 'queued' && !launchGuardRef.current.has(item.id)).slice(0, availableSlots);
    nextQueued.forEach((item) => {
      void startUpload(item.id);
    });
  }, [concurrencyLimit, startUpload, uploadItems]);

  const onInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files ? Array.from(event.target.files) : [];
      addFiles(files);
      event.target.value = '';
    },
    [addFiles],
  );

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragDepthRef.current = 0;
      setDragActive(false);
      addFiles(Array.from(event.dataTransfer.files));
    },
    [addFiles],
  );

  const onDragEnter = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepthRef.current += 1;
    setDragActive(true);
  }, []);

  const onDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setDragActive(false);
    }
  }, []);

  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  }, []);

  const openPicker = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const hasFinishedItems = stats.success + stats.failed + stats.cancelled > 0;
  const showDragOverlay = dragActive && !prefersReducedMotion;

  return (
    <section className="mx-auto w-full max-w-6xl space-y-5">
      <div className="overflow-hidden rounded-[34px] border border-white/10 bg-white/5 shadow-glow backdrop-blur">
        <div className="relative px-5 py-5 sm:px-6 sm:py-6">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.12),transparent_36%),radial-gradient(circle_at_bottom_left,rgba(255,207,92,0.14),transparent_24%)]" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-xs uppercase tracking-[0.24em] text-white/45">Uploads</p>
              <h2 className="mt-2 font-[family-name:var(--font-space-grotesk)] text-3xl font-semibold tracking-tight sm:text-4xl">
                Upload queue
              </h2>
              <p className="mt-3 max-w-xl text-sm leading-6 text-white/68 sm:text-base">
                Drop files, queue them in batches, and let several uploads run in parallel without freezing the page.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {CONCURRENCY_OPTIONS.map((option) => {
                const active = option === concurrencyLimit;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setConcurrencyLimit(option)}
                    className={`rounded-full border px-4 py-2 text-xs uppercase tracking-[0.18em] transition ${
                      active
                        ? 'border-accent-300/40 bg-accent-400 text-ink-900'
                        : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10'
                    }`}
                  >
                    {option} parallel
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
        className={`relative overflow-hidden rounded-[34px] border border-dashed p-5 shadow-glow transition sm:p-6 ${
          dragActive ? 'border-accent-300/50 bg-accent-400/10' : 'border-white/15 bg-black/20'
        }`}
      >
        <input ref={inputRef} type="file" multiple onChange={onInputChange} className="sr-only" />

        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/10 text-accent-200">
              <Upload className="h-6 w-6" />
            </div>
            <div>
              <h3 className="font-[family-name:var(--font-space-grotesk)] text-xl font-semibold tracking-tight">
                Drop photos, videos, and files
              </h3>
              <p className="mt-1 max-w-2xl text-sm text-white/65">
                Batch-select from the picker or drag files directly into the queue. Each file uploads independently, so one failure will not block the rest.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={openPicker}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-4 py-3 text-sm font-semibold text-ink-900 transition hover:bg-accent-100"
            >
              <ArrowUpFromLine className="h-4 w-4" />
              Choose files
            </button>
            {hasFinishedItems ? (
              <button
                type="button"
                onClick={clearFinished}
                className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white/78 transition hover:bg-white/10"
              >
                <Trash2 className="h-4 w-4" />
                Clear completed
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-5 grid gap-3 text-xs uppercase tracking-[0.2em] text-white/50 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-2xl border border-white/8 bg-white/5 px-3 py-2">{stats.total} in queue</div>
          <div className="rounded-2xl border border-white/8 bg-white/5 px-3 py-2">{stats.uploading} uploading</div>
          <div className="rounded-2xl border border-white/8 bg-white/5 px-3 py-2">{stats.queued} waiting</div>
          <div className="rounded-2xl border border-white/8 bg-white/5 px-3 py-2">{stats.success} finished</div>
          <div className="rounded-2xl border border-white/8 bg-white/5 px-3 py-2">{stats.failed + stats.cancelled} attention</div>
        </div>

        <div className="mt-4 space-y-1 text-sm text-white/68">
          <p>{message}</p>
          <p className="text-white/48">{queueSummary}</p>
          <p className="text-white/48">{RECOMMENDED_BATCH_TEXT}.</p>
          <p className="text-white/48">Max file size: {MAX_FILE_SIZE_MB} MB. {SUPPORTED_TYPE_LABEL}.</p>
          <p className="text-white/48">Uploads run in parallel. Large videos and slower networks may take a few minutes.</p>
        </div>

        <AnimatePresence>
          {showDragOverlay ? (
            <M.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-[34px] bg-ink-900/70 backdrop-blur"
            >
              <div className="rounded-[28px] border border-white/10 bg-white/8 px-6 py-5 text-center shadow-glow">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-accent-300/30 bg-accent-400/10 text-accent-200">
                  <Upload className="h-6 w-6" />
                </div>
                <p className="mt-4 font-[family-name:var(--font-space-grotesk)] text-2xl font-semibold">Drop files to upload</p>
                <p className="mt-1 text-sm text-white/65">Files will be added to the queue automatically.</p>
              </div>
            </M.div>
          ) : null}
        </AnimatePresence>
      </div>

      <div className="grid gap-3">
        <AnimatePresence initial={false}>
          {uploadItems.length ? (
            uploadItems.map((item) => (
              <M.article
                key={item.id}
                layout={!prefersReducedMotion}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.22 }}
                className={`overflow-hidden rounded-[28px] border bg-white/5 shadow-glow backdrop-blur ${getStatusTone(item.status)}`}
              >
                <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:p-5">
                  <div className="relative h-24 w-full shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-black/20 sm:h-28 sm:w-40">
                    {item.previewKind === 'image' && item.previewUrl ? (
                      <img src={item.previewUrl} alt={item.file.name} className="h-full w-full object-cover" />
                    ) : item.previewKind === 'video' && item.previewUrl ? (
                      <div className="relative h-full w-full bg-[linear-gradient(135deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02))]">
                        <video src={item.previewUrl} className="h-full w-full object-cover opacity-60" muted playsInline preload="metadata" />
                        <div className="absolute inset-0 flex items-center justify-center bg-ink-900/28 text-white/85">
                          <Film className="h-8 w-8" />
                        </div>
                      </div>
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.12),transparent_45%),linear-gradient(135deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] text-white/80">
                        {item.previewKind === 'file' ? <FileText className="h-8 w-8" /> : <FileImage className="h-8 w-8" />}
                      </div>
                    )}

                    <div className={`absolute left-2 top-2 inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.18em] ${getStatusTone(item.status)}`}>
                      {item.status === 'uploading' ? <Loader2 className="h-3 w-3 animate-spin" /> : item.status === 'success' ? <CheckCircle2 className="h-3 w-3" /> : item.status === 'failed' ? <CircleAlert className="h-3 w-3" /> : null}
                      {getStatusLabel(item.status)}
                    </div>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate font-[family-name:var(--font-space-grotesk)] text-lg font-semibold text-white">{item.file.name}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-white/62">
                          <span>{formatBytes(item.file.size)}</span>
                          <span className="h-1 w-1 rounded-full bg-white/25" />
                          <span>{item.file.type || 'unknown type'}</span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {item.status === 'queued' ? (
                          <button
                            type="button"
                            onClick={() => cancelUpload(item.id)}
                            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/70 transition hover:bg-white/10"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Cancel
                          </button>
                        ) : null}
                        {item.status === 'uploading' ? (
                          <button
                            type="button"
                            onClick={() => cancelUpload(item.id)}
                            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/70 transition hover:bg-white/10"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Cancel upload
                          </button>
                        ) : null}
                        {(item.status === 'failed' || item.status === 'cancelled') ? (
                          <button
                            type="button"
                            onClick={() => retryUpload(item.id)}
                            className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-ink-900 transition hover:bg-accent-100"
                          >
                            <RefreshCcw className="h-3.5 w-3.5" />
                            Retry
                          </button>
                        ) : null}
                        {item.status !== 'uploading' ? (
                          <button
                            type="button"
                            onClick={() => removeItem(item.id)}
                            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white/70 transition hover:bg-white/10"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Dismiss
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-4 space-y-3">
                      <div className="h-2 overflow-hidden rounded-full bg-white/10">
                        <div
                          className={`h-full rounded-full transition-all ${item.status === 'failed' ? 'bg-rose-400' : item.status === 'cancelled' ? 'bg-white/35' : item.status === 'success' ? 'bg-emerald-400' : 'bg-accent-400'}`}
                          style={{ width: `${item.progress}%` }}
                        />
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-white/65">
                        <div className="flex flex-wrap items-center gap-2">
                          <span>{item.progress}%</span>
                          <span className="h-1 w-1 rounded-full bg-white/25" />
                          <span>{item.transferLabel ?? getStatusLabel(item.status)}</span>
                          {item.etaLabel ? (
                            <>
                              <span className="h-1 w-1 rounded-full bg-white/25" />
                              <span>{item.etaLabel}</span>
                            </>
                          ) : null}
                        </div>
                        {item.status === 'success' && item.mediaId ? (
                          <span className="text-emerald-200">Saved to gallery</span>
                        ) : null}
                      </div>

                      {item.status === 'uploading' ? (
                        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-white/45">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Uploading
                        </div>
                      ) : null}

                      {item.error ? (
                        <p className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/70">{item.error}</p>
                      ) : null}
                    </div>
                  </div>
                </div>
              </M.article>
            ))
          ) : (
            <div className="rounded-[28px] border border-white/10 bg-white/5 p-6 text-sm text-white/62">
              No files queued yet. Use the picker above or drag files into the drop zone to start uploading.
            </div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
