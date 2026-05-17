"use client";

import { useMemo, useState } from 'react';
import { Link2, Loader2, ShieldCheck } from 'lucide-react';

import { useAuth } from '@/components/auth-provider';

export function SettingsScreen() {
  const { user, linkGoogleToCurrentUser, linkPasswordToCurrentUser } = useAuth();

  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('Manage linked sign-in providers for your account.');

  const providers = useMemo(() => {
    return (user?.providerData ?? [])
      .map((entry) => entry.providerId)
      .filter(Boolean)
      .filter((value, index, list) => list.indexOf(value) === index);
  }, [user?.providerData]);

  const run = async (action: string, callback: () => Promise<void>) => {
    setBusy(action);
    try {
      await callback();
      setMessage('Settings updated.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Action failed.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mx-auto w-full max-w-3xl rounded-[32px] border border-white/10 bg-white/5 p-5 shadow-glow backdrop-blur sm:p-6">
      <p className="text-xs uppercase tracking-[0.24em] text-white/45">Settings</p>
      <h2 className="mt-2 font-[family-name:var(--font-space-grotesk)] text-2xl font-semibold tracking-tight">Identity and providers</h2>

      <div className="mt-4 flex flex-wrap gap-2">
        {providers.length ? providers.map((providerId) => (
          <span key={providerId} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.2em] text-white/70">
            {providerId}
          </span>
        )) : (
          <span className="text-sm text-white/55">No linked providers found.</span>
        )}
      </div>

      {!providers.includes('google.com') ? (
        <button
          type="button"
          onClick={() => void run('link-google', linkGoogleToCurrentUser)}
          disabled={busy !== null}
          className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-accent-400 px-4 py-2.5 text-sm font-semibold text-ink-900 transition hover:bg-accent-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy === 'link-google' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
          Link Google
        </button>
      ) : null}

      {!providers.includes('password') ? (
        <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="text-sm text-white/70">Add a password sign-in method</p>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Create password"
            className="mt-3 w-full rounded-xl border border-white/10 bg-ink-900/70 px-3 py-2 text-sm outline-none placeholder:text-white/30 focus:border-accent-400/40"
          />
          <button
            type="button"
            onClick={() => void run('link-password', () => linkPasswordToCurrentUser(password))}
            disabled={busy !== null || password.length < 6}
            className="mt-3 inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/80 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy === 'link-password' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Add password login
          </button>
        </div>
      ) : null}

      <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-white/70">{message}</div>
    </section>
  );
}
