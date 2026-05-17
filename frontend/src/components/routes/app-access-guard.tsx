"use client";

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';

import { useAuth } from '@/components/auth-provider';
import { fetchTelegramStatus } from '@/lib/api';

type GuardStatus = 'checking' | 'ready';

const sleep = (ms: number) => new Promise<void>((resolve) => globalThis.setTimeout(resolve, ms));

export function AppAccessGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading, getIdToken } = useAuth();
  const [status, setStatus] = useState<GuardStatus>('checking');

  useEffect(() => {
    if (loading) {
      setStatus('checking');
      return;
    }

    let active = true;

    const verify = async () => {
      if (!user) {
        router.replace('/login');
        return;
      }

      let idToken: string | null = null;
      for (let attempt = 0; attempt < 5 && active && !idToken; attempt += 1) {
        idToken = await getIdToken();
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
        telegram = await fetchTelegramStatus(idToken).catch(() => null);
        if (!telegram) {
          await sleep(250 * (attempt + 1));
        }
      }

      if (!active) {
        return;
      }

      if (!telegram) {
        setStatus('ready');
        return;
      }

      if (!telegram.linked && pathname !== '/onboarding/telegram') {
        const reason = telegram.reconnect_required ? 'session-expired' : 'telegram-not-linked';
        router.replace(`/onboarding/telegram?reason=${encodeURIComponent(reason)}`);
        return;
      }

      setStatus('ready');
    };

    setStatus('checking');
    void verify();

    return () => {
      active = false;
    };
  }, [getIdToken, loading, pathname, router, user]);

  if (status !== 'ready') {
    return (
      <div className="flex min-h-screen items-center justify-center text-white/70">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return <>{children}</>;
}
