import type { MediaItem, MediaKind, MediaListPage, TelegramStatus } from '@/lib/types';
import { getApiBaseUrl } from '@/lib/runtime-env';

const apiBaseUrl = getApiBaseUrl();

async function authedFetch(idToken: string, path: string, init: RequestInit = {}) {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${idToken}`,
      },
    });
  } catch {
    throw new Error(`Can't reach the PixlVault API at ${apiBaseUrl}. Check that the backend is running.`);
  }

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const message = errorBody?.message ?? errorBody?.detail ?? 'Request failed';
    throw new Error(message);
  }

  return response.json();
}

export async function fetchTelegramStatus(idToken: string): Promise<TelegramStatus> {
  return authedFetch(idToken, '/telegram/status');
}

export async function requestTelegramOtp(idToken: string, phoneNumber: string, forceResend = false, channelName?: string) {
  return authedFetch(idToken, '/telegram/request-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
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
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({
      challenge_id: challengeId,
      otp_code: otpCode,
      two_factor_password: twoFactorPassword || null,
    }),
  });
}

export async function unlinkTelegram(idToken: string): Promise<{ unlinked: boolean }> {
  return authedFetch(idToken, '/telegram/link', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${idToken}` },
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
  return authedFetch(idToken, query ? `/media?${query}` : '/media');
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
        reject(new Error('Upload failed'));
      }
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

export async function fetchMediaAssetBlob(idToken: string, mediaId: string, kind: 'thumbnail' | 'content'): Promise<Blob> {
  const response = await fetch(`${apiBaseUrl}/media/${mediaId}/${kind}`, {
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const message = errorBody?.message ?? errorBody?.detail ?? 'Failed to load media asset';
    throw new Error(message);
  }

  return await response.blob();
}

export async function fetchMediaStreamUrl(idToken: string, mediaId: string): Promise<{ stream_url: string; expires_in_seconds: number }> {
  return authedFetch(idToken, `/media/${mediaId}/stream-url`);
}
