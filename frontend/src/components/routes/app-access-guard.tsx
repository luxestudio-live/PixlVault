"use client";

import { useEffect, useState } from 'react';
import { Loader2, TriangleAlert } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';

import { useAuth } from '@/components/auth-provider';
import { fetchTelegramStatus } from '@/lib/api';

type GuardStatus = 'checking' | 'ready';

const sleep = (ms: number) => new Promise<void>((resolve) => globalThis.setTimeout(resolve, ms));
const ROUTE_RESOLUTION_TIMEOUT_MS = 12000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      globalThis.setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    }),
  ]);
}

export function AppAccessGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading, getIdToken } = useAuth();
  const [status, setStatus] = useState<GuardStatus>('checking');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading) {
      setStatus('checking');
      setError(null);
      return;
    }

    let active = true;

    const verify = async () => {
      if (!user) {
        router.replace('/login');
        return;
      }

      try {
        let idToken: string | null = null;
        for (let attempt = 0; attempt < 5 && active && !idToken; attempt += 1) {
          idToken = await withTimeout(getIdToken(), ROUTE_RESOLUTION_TIMEOUT_MS, 'Authentication is taking too long. Please refresh and try again.');
          if (!idToken) {
            await sleep(200 * (attempt + 1));
          }
        }

        if (!active) {
          return;
        }

        if (!idToken) {
          setStatus('ready');
          return;
        }

        let telegram: Awaited<ReturnType<typeof fetchTelegramStatus>> | null = null;
        for (let attempt = 0; attempt < 3 && active && !telegram; attempt += 1) {
          telegram = await withTimeout(
            fetchTelegramStatus(idToken).catch(() => null),
            ROUTE_RESOLUTION_TIMEOUT_MS,
            'Telegram status lookup timed out. Please refresh and try again.',
          );
          if (!telegram) {
            await sleep(250 * (attempt + 1));
          }
        }

        if (!active) {
          return;
        }

        if (!telegram) {
          setError('We could not verify Telegram right now. Refresh the page to retry.');
          setStatus('ready');
          return;
        }

        if (!telegram.linked && pathname !== '/onboarding/telegram') {
          const reason = telegram.reconnect_required ? 'session-expired' : 'telegram-not-linked';
          router.replace(`/onboarding/telegram?reason=${encodeURIComponent(reason)}`);
          return;
        }

        setStatus('ready');
      } catch (resolveError) {
        if (!active) {
          return;
        }

        setError(resolveError instanceof Error ? resolveError.message : 'Unable to verify your session right now.');
        setStatus('ready');
      }
    };

    setStatus('checking');
    setError(null);
    void verify();

    return () => {
      active = false;
    };
  }, [getIdToken, loading, pathname, router, user]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 text-white">
        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-black/30 p-6 text-center shadow-[0_20px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl">
          <TriangleAlert className="mx-auto h-6 w-6 text-amber-300" />
          <h2 className="mt-4 text-lg font-semibold">Unable to load PixlVault</h2>
          <p className="mt-2 text-sm leading-6 text-white/65">{error}</p>
          <button
            type="button"
            onClick={() => globalThis.location.reload()}
            className="mt-5 rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-white/90"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }

  if (status !== 'ready') {
    return (
      <div className="flex min-h-screen items-center justify-center text-white/70">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return <>{children}</>;
}
