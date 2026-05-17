"use client";

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/components/auth-provider';
import { fetchTelegramStatus } from '@/lib/api';

const sleep = (ms: number) => new Promise<void>((resolve) => globalThis.setTimeout(resolve, ms));

export function GuestOnly({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, loading, getIdToken } = useAuth();
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    if (loading || !user) {
      return;
    }

    let active = true;

    const resolveRoute = async () => {
      setResolving(true);
      try {
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
          if (active) {
            router.replace('/app/gallery');
          }
          return;
        }

        let status: Awaited<ReturnType<typeof fetchTelegramStatus>> | null = null;
        for (let attempt = 0; attempt < 3 && active && !status; attempt += 1) {
          status = await fetchTelegramStatus(idToken).catch(() => null);
          if (!status) {
            await sleep(250 * (attempt + 1));
          }
        }

        if (!active) {
          return;
        }

        if (!status) {
          router.replace('/app/gallery');
          return;
        }

        router.replace(status.linked ? '/app/gallery' : '/onboarding/telegram');
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
