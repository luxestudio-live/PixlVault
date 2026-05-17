"use client";

import { useMemo } from 'react';
import { Grid2X2, LogOut, Settings, Upload, UserCircle2 } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import { useAuth } from '@/components/auth-provider';

const M: any = motion;

const navItems = [
  { href: '/app/gallery', label: 'Gallery', icon: Grid2X2 },
  { href: '/app/uploads', label: 'Uploads', icon: Upload },
  { href: '/app/settings', label: 'Settings', icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOutUser } = useAuth();

  const isViewer = pathname.startsWith('/app/viewer/');

  const pageLabel = useMemo(() => {
    const active = navItems.find((entry) => pathname.startsWith(entry.href));
    if (active) {
      return active.label;
    }
    if (isViewer) {
      return 'Viewer';
    }
    return 'App';
  }, [isViewer, pathname]);

  if (isViewer) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-mesh-gradient text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-[1600px]">
        <aside className="hidden w-72 border-r border-white/10 bg-black/20 p-5 backdrop-blur md:flex md:flex-col">
          <Link href="/app/gallery" className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
            <p className="text-xs uppercase tracking-[0.24em] text-white/45">PixlVault</p>
            <p className="mt-1 font-[family-name:var(--font-space-grotesk)] text-xl font-semibold">Media Cloud</p>
          </Link>

          <nav className="mt-6 space-y-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-sm transition ${
                    active ? 'bg-accent-400 text-ink-900' : 'bg-white/5 text-white/75 hover:bg-white/10'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="mt-auto rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
            <div className="flex items-center gap-2 text-white/85">
              <UserCircle2 className="h-4 w-4" />
              <span className="truncate">{user?.email ?? 'Signed in'}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                void signOutUser().then(() => router.replace('/login'));
              }}
              className="mt-3 inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs uppercase tracking-[0.18em] text-white/70 transition hover:bg-white/10"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 border-b border-white/10 bg-ink-900/70 px-4 py-3 backdrop-blur sm:px-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.24em] text-white/45">Workspace</p>
                <h1 className="font-[family-name:var(--font-space-grotesk)] text-xl font-semibold">{pageLabel}</h1>
              </div>
              <Link href="/onboarding/telegram" className="rounded-full border border-white/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-white/65 transition hover:bg-white/10">
                Telegram onboarding
              </Link>
            </div>
          </header>

          <main className="min-h-0 flex-1 p-4 pb-24 sm:p-6 sm:pb-24">
            <AnimatePresence mode="wait" initial={false}>
              <M.div
                key={pathname}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.24 }}
              >
                {children}
              </M.div>
            </AnimatePresence>
          </main>
        </div>
      </div>

      <nav aria-label="Primary" className="fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-40 grid grid-cols-3 gap-2 rounded-2xl border border-white/10 bg-ink-900/85 p-2 backdrop-blur md:hidden">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] uppercase tracking-[0.18em] ${
                active ? 'bg-accent-400 text-ink-900' : 'text-white/70'
              }`}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
