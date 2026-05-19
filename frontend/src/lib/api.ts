import type { MediaItem, MediaKind, MediaListPage, TelegramStatus } from '@/lib/types';
import { getApiBaseUrl } from '@/lib/runtime-env';

const apiBaseUrl = getApiBaseUrl();
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
const DEFAULT_VERIFY_OTP_TIMEOUT_MS = 90000;
const DEFAULT_UPLOAD_TIMEOUT_MS = 60000;

export type TelegramOtpResponse = {
  challenge_id: string;
  phone_number: string;
  expires_in_seconds: number;
};

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

async function readApiErrorMessage(response: Response, fallbackMessage: string): Promise<string> {
  const rawBody = await response.text().catch(() => '');
  if (!rawBody) {
    return fallbackMessage;
  }

  try {
    const parsed = JSON.parse(rawBody) as { message?: string; detail?: string };
    return parsed.message ?? parsed.detail ?? fallbackMessage;
  } catch {
    return rawBody;
  }
}

async function authedFetchResponse(idToken: string, path: string, init: RequestInit = {}, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutHandle = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = new Headers(init.headers ?? {});
    headers.set('Authorization', `Bearer ${idToken}`);

    return await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`PixlVault API request timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    }

    throw new Error(`Can't reach the PixlVault API at ${apiBaseUrl}. Check that the backend is running.`);
  } finally {
    globalThis.clearTimeout(timeoutHandle);
  }
}

async function authedFetch<T>(idToken: string, path: string, init: RequestInit = {}, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<T> {
  const response = await authedFetchResponse(idToken, path, init, timeoutMs);

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Request failed'));
  }

  return response.json() as Promise<T>;
}

export async function fetchTelegramStatus(idToken: string): Promise<TelegramStatus> {
  return authedFetch<TelegramStatus>(idToken, '/telegram/status');
}

export async function requestTelegramOtp(idToken: string, phoneNumber: string, forceResend = false, channelName?: string) {
  return authedFetch<TelegramOtpResponse>(idToken, '/telegram/request-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone_number: phoneNumber, force_resend: forceResend, channel_name: channelName ?? null }),
  });
}

export async function verifyTelegramOtp(
  idToken: string,
  challengeId: string,
  otpCode: string,
  twoFactorPassword?: string,
) {
  return authedFetch(idToken, '/telegram/verify-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      challenge_id: challengeId,
      otp_code: otpCode,
      two_factor_password: twoFactorPassword || null,
    }),
  }, DEFAULT_VERIFY_OTP_TIMEOUT_MS);
}

export async function unlinkTelegram(idToken: string): Promise<{ unlinked: boolean }> {
  return authedFetch<{ unlinked: boolean }>(idToken, '/telegram/link', {
    method: 'DELETE',
  });
}

export async function listMedia(
  idToken: string,
  options: { cursor?: string | null; limit?: number; kind?: MediaKind } = {},
): Promise<MediaListPage> {
  const searchParams = new URLSearchParams();
  if (typeof options.limit === 'number') {
    searchParams.set('limit', String(options.limit));
  }
  if (options.cursor) {
    searchParams.set('cursor', options.cursor);
  }
  if (options.kind && options.kind !== 'all') {
    searchParams.set('kind', options.kind);
  }

  const query = searchParams.toString();
  return authedFetch<MediaListPage>(idToken, query ? `/media?${query}` : '/media');
}

export type MediaUploadHandle = {
  promise: Promise<MediaItem>;
  cancel: () => void;
};

export function createMediaUpload(
  idToken: string,
  file: File,
  onProgress?: (progress: number) => void,
): MediaUploadHandle {
  const formData = new FormData();
  formData.append('file', file);

  const xhr = new XMLHttpRequest();
  let settled = false;

  const promise = new Promise<MediaItem>((resolve, reject) => {
    xhr.open('POST', `${apiBaseUrl}/media/upload`);
    xhr.setRequestHeader('Authorization', `Bearer ${idToken}`);
    xhr.timeout = DEFAULT_UPLOAD_TIMEOUT_MS;

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !onProgress) {
        return;
      }

      onProgress(Math.round((event.loaded / event.total) * 100));
    };

    xhr.onload = () => {
      if (settled) {
        return;
      }

      settled = true;

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText) as MediaItem);
        return;
      }

      try {
        const errorBody = JSON.parse(xhr.responseText) as { message?: string; detail?: string };
        reject(new Error(errorBody.message ?? errorBody.detail ?? 'Upload failed'));
      } catch {
        reject(new Error(xhr.responseText || 'Upload failed'));
      }
    };

    xhr.ontimeout = () => {
      if (settled) {
        return;
      }

      settled = true;
      reject(new Error(`Upload timed out after ${Math.round(DEFAULT_UPLOAD_TIMEOUT_MS / 1000)} seconds.`));
    };

    xhr.onerror = () => {
      if (settled) {
        return;
      }

      settled = true;
      reject(new Error('Upload failed'));
    };

    xhr.onabort = () => {
      if (settled) {
        return;
      }

      settled = true;
      reject(new Error('Upload cancelled'));
    };

    xhr.send(formData);
  });

  return {
    promise,
    cancel: () => {
      if (!settled && xhr.readyState !== XMLHttpRequest.DONE) {
        xhr.abort();
      }
    },
  };
}

export async function uploadMedia(
  idToken: string,
  file: File,
  onProgress?: (progress: number) => void,
): Promise<MediaItem> {
  return await createMediaUpload(idToken, file, onProgress).promise;
}

export async function fetchMediaAssetBlob(
  idToken: string,
  mediaId: string,
  kind: 'thumbnail' | 'content',
  options: { cacheBust?: string } = {},
): Promise<Blob> {
  const searchParams = new URLSearchParams();
  if (options.cacheBust) {
    searchParams.set('v', options.cacheBust);
  }

  const query = searchParams.toString();
  const path = query ? `/media/${mediaId}/${kind}?${query}` : `/media/${mediaId}/${kind}`;
  const response = await authedFetchResponse(idToken, path);

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, 'Failed to load media asset'));
  }

  return await response.blob();
}

export async function fetchMediaStreamUrl(idToken: string, mediaId: string): Promise<{ stream_url: string; expires_in_seconds: number }> {
  return authedFetch<{ stream_url: string; expires_in_seconds: number }>(idToken, `/media/${mediaId}/stream-url`);
}
