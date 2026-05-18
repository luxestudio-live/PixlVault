"use client";

import { useEffect, useState } from 'react';
import { Loader2, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/components/auth-provider';
import { fetchTelegramStatus } from '@/lib/api';

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

export function GuestOnly({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, loading, getIdToken } = useAuth();
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading || !user) {
      setError(null);
      return;
    }

    let active = true;

    const resolveRoute = async () => {
      setResolving(true);
      setError(null);
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
          if (active) {
            router.replace('/app/gallery');
          }
          return;
        }

        let status: Awaited<ReturnType<typeof fetchTelegramStatus>> | null = null;
        for (let attempt = 0; attempt < 3 && active && !status; attempt += 1) {
          status = await withTimeout(
            fetchTelegramStatus(idToken).catch(() => null),
            ROUTE_RESOLUTION_TIMEOUT_MS,
            'Telegram status lookup timed out. Please refresh and try again.',
          );
          if (!status) {
            await sleep(250 * (attempt + 1));
          }
        }

        if (!active) {
          return;
        }

        if (!status) {
          setError('We could not verify Telegram right now. Refresh the page to retry.');
          return;
        }

        router.replace(status.linked ? '/app/gallery' : '/onboarding/telegram');
      } catch (resolveError) {
        if (active) {
          setError(resolveError instanceof Error ? resolveError.message : 'Unable to continue right now.');
        }
      } finally {
        if (active) {
          setResolving(false);
        }
      }
    };

    void resolveRoute();

    return () => {
      active = false;
    };
  }, [getIdToken, loading, router, user]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 text-white">
        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-black/30 p-6 text-center shadow-[0_20px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl">
          <TriangleAlert className="mx-auto h-6 w-6 text-amber-300" />
          <h2 className="mt-4 text-lg font-semibold">Unable to continue</h2>
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

  if (loading || resolving) {
    return (
      <div className="flex min-h-screen items-center justify-center text-white/70">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-white/70">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return <>{children}</>;
}
