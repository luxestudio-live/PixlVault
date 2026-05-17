"use client";

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Check, Loader2, Sparkles, Shield, WandSparkles } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/components/auth-provider';
import { fetchTelegramStatus } from '@/lib/api';

type Mode = 'login' | 'signup';

const M: any = motion;

const PASSWORD_HINTS = [
  'Use at least 8 characters',
  'Mix letters, numbers, and symbols',
  'Avoid reused passwords',
];

export function AuthScreen({ mode }: { mode: Mode }) {
  const router = useRouter();
  const { user, loading, signInWithGoogle, signInWithEmail, signUpWithEmail, sendPasswordReset, getIdToken } = useAuth();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const title = useMemo(() => (mode === 'login' ? 'Welcome back' : 'Create your account'), [mode]);
  const subtitle = useMemo(
    () =>
      mode === 'login'
        ? 'Sign in to your private gallery and continue where you left off.'
        : 'Create a private, gallery-first account in under a minute.',
    [mode],
  );

  const passwordScore = useMemo(() => {
    if (mode !== 'signup') {
      return 0;
    }

    let score = 0;
    if (password.length >= 8) score += 1;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1;
    if (/\d/.test(password)) score += 1;
    if (/[^A-Za-z0-9]/.test(password)) score += 1;
    return score;
  }, [mode, password]);

  const resolvePostAuthRoute = async () => {
    const token = await getIdToken();
    if (!token) {
      return '/app/gallery';
    }
    const status = await fetchTelegramStatus(token).catch(() => ({ linked: false, reconnect_required: false }));
    if (status.linked) {
      return '/app/gallery';
    }

    const reason = status.reconnect_required ? 'session-expired' : 'telegram-not-linked';
    return `/onboarding/telegram?reason=${encodeURIComponent(reason)}`;
  };

  useEffect(() => {
    if (loading || !user) {
      return;
    }

    let active = true;
    void (async () => {
      const destination = await resolvePostAuthRoute();
      if (active) {
        router.replace(destination);
      }
    })();

    return () => {
      active = false;
    };
  }, [loading, router, user]);

  const run = async (action: string, callback: () => Promise<void>) => {
    setBusy(action);
    setError(null);
    setMessage(null);
    try {
      await callback();
      const destination = await resolvePostAuthRoute();
      router.replace(destination);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setBusy(null);
    }
  };

  const handlePrimaryAction = async () => {
    if (mode === 'login') {
      if (!email || !password) {
        setError('Enter your email and password to continue.');
        return;
      }

      await run('login', () => signInWithEmail(email, password));
      return;
    }

    if (!fullName.trim() || !email || !password || !confirmPassword) {
      setError('Complete all fields to create your account.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    if (passwordScore < 2) {
      setError('Choose a stronger password before continuing.');
      return;
    }

    await run('signup', () => signUpWithEmail(email, password, fullName));
  };

  const handleForgotPassword = async () => {
    if (!email) {
      setError('Enter your email first, then we can send a reset link.');
      return;
    }

    await run('reset', async () => {
      await sendPasswordReset(email);
      setMessage('Password reset email sent. Check your inbox.');
    });
  };

  const shouldShowSignupExtras = mode === 'signup';

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#050814] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(120,92,255,0.16),transparent_24%),radial-gradient(circle_at_top_right,rgba(53,176,255,0.14),transparent_22%),radial-gradient(circle_at_bottom,rgba(68,216,185,0.1),transparent_30%)]" />
      <div className="pointer-events-none absolute -left-24 top-16 h-72 w-72 rounded-full bg-cyan-400/10 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 top-32 h-80 w-80 rounded-full bg-violet-500/10 blur-3xl" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-44 bg-[linear-gradient(180deg,transparent,rgba(5,8,20,0.75))]" />

      <div className="mx-auto flex min-h-screen w-full max-w-7xl items-center px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <div className="grid w-full items-stretch gap-5 lg:grid-cols-[1fr_0.92fr] lg:gap-6">
          <M.section
            initial={{ opacity: 0, y: 18, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
            className="relative hidden overflow-hidden rounded-[36px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))] p-8 shadow-[0_30px_120px_rgba(0,0,0,0.45)] backdrop-blur-xl lg:flex lg:flex-col lg:justify-between"
          >
            <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.08),transparent_26%,rgba(82,161,255,0.05)_58%,transparent_82%)]" />
            <div className="absolute -right-20 top-10 h-56 w-56 rounded-full bg-cyan-300/10 blur-3xl" />
            <div className="absolute -left-16 bottom-4 h-52 w-52 rounded-full bg-violet-400/10 blur-3xl" />

            <div className="relative z-10 max-w-xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] uppercase tracking-[0.28em] text-accent-200">
                <Sparkles className="h-3.5 w-3.5" />
                PixlVault Cloud
              </div>
              <h1 className="mt-6 max-w-lg font-[family-name:var(--font-space-grotesk)] text-5xl font-semibold tracking-tight">
                {mode === 'login' ? 'Return to your private gallery.' : 'Create a premium private space for your media.'}
              </h1>
              <p className="mt-4 max-w-lg text-base leading-7 text-white/64">{subtitle}</p>

              <div className="mt-8 flex flex-wrap gap-2 text-xs uppercase tracking-[0.22em] text-white/45">
                {['Encrypted sign-in', 'Gallery sync', 'Telegram access'].map((item) => (
                  <span key={item} className="rounded-full border border-white/10 bg-black/18 px-3 py-2">
                    {item}
                  </span>
                ))}
              </div>
            </div>

            <div className="relative z-10 mt-10 overflow-hidden rounded-[30px] border border-white/10 bg-black/20 p-4 shadow-[0_22px_60px_rgba(0,0,0,0.3)] backdrop-blur-md">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.12),transparent_32%),radial-gradient(circle_at_bottom_left,rgba(129,140,248,0.12),transparent_28%)]" />
              <div className="relative grid grid-cols-3 gap-2">
                <div className="aspect-[4/5] rounded-2xl bg-[linear-gradient(180deg,rgba(99,102,241,0.82),rgba(11,16,34,0.18))] shadow-[0_18px_60px_rgba(71,85,255,0.25)]" />
                <div className="mt-3 aspect-[4/5] rounded-2xl bg-[linear-gradient(180deg,rgba(34,197,94,0.46),rgba(11,16,34,0.16))]" />
                <div className="aspect-[4/5] rounded-2xl bg-[linear-gradient(180deg,rgba(56,189,248,0.58),rgba(11,16,34,0.18))] shadow-[0_18px_60px_rgba(34,211,238,0.22)]" />
              </div>
              <div className="relative mt-4 flex items-center justify-between text-[11px] uppercase tracking-[0.24em] text-white/42">
                <span>Encrypted cloud</span>
                <span>Immersive viewer</span>
              </div>
            </div>
          </M.section>

          <M.section
            initial={{ opacity: 0, y: 18, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.45, delay: 0.05, ease: [0.2, 0.8, 0.2, 1] }}
            className="relative flex min-h-[min(820px,calc(100vh-2rem))] flex-col overflow-hidden rounded-[34px] border border-white/10 bg-[linear-gradient(180deg,rgba(10,14,28,0.92),rgba(7,10,18,0.98))] shadow-[0_30px_120px_rgba(0,0,0,0.55)] backdrop-blur-xl sm:min-h-[min(820px,calc(100vh-3rem))]"
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(129,140,248,0.15),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(56,189,248,0.1),transparent_30%),linear-gradient(135deg,rgba(255,255,255,0.05),transparent_22%)]" />

            <div className="relative z-10 border-b border-white/8 px-5 pb-4 pt-5 sm:px-7 sm:pb-5 sm:pt-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.28em] text-white/42">Authentication</p>
                  <h2 className="mt-2 font-[family-name:var(--font-space-grotesk)] text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h2>
                  <p className="mt-2 max-w-md text-sm leading-6 text-white/60">{subtitle}</p>
                </div>
                <Link href={mode === 'login' ? '/signup' : '/login'} className="hidden rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.2em] text-white/65 transition hover:bg-white/10 sm:inline-flex">
                  {mode === 'login' ? 'Create account' : 'Sign in'}
                </Link>
              </div>
            </div>

            <div className="relative z-10 flex-1 px-5 py-5 sm:px-7 sm:py-7">
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handlePrimaryAction();
                }}
              >
                <AnimatePresence mode="wait" initial={false}>
                  {shouldShowSignupExtras ? (
                    <M.div
                      key="signup-name"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.22 }}
                    >
                      <label className="block space-y-2">
                        <span className="text-sm font-medium text-white/74">Full name</span>
                        <input
                          value={fullName}
                          onChange={(event) => setFullName(event.target.value)}
                          placeholder="Alex Morgan"
                          autoComplete="name"
                          className="auth-input"
                        />
                      </label>
                    </M.div>
                  ) : null}
                </AnimatePresence>

                <label className="block space-y-2">
                  <span className="text-sm font-medium text-white/74">Email</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="name@company.com"
                    autoComplete="email"
                    className="auth-input"
                  />
                </label>

                <label className="block space-y-2">
                  <span className="text-sm font-medium text-white/74">Password</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder={mode === 'login' ? 'Your password' : 'Create a strong password'}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    className="auth-input"
                  />
                </label>

                {shouldShowSignupExtras ? (
                  <>
                    <label className="block space-y-2">
                      <span className="text-sm font-medium text-white/74">Confirm password</span>
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        placeholder="Repeat your password"
                        autoComplete="new-password"
                        className="auth-input"
                      />
                    </label>

                    <div className="rounded-3xl border border-white/8 bg-white/4 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs uppercase tracking-[0.24em] text-white/45">Password strength</p>
                        <div className="flex gap-1.5">
                          {[0, 1, 2, 3].map((index) => (
                            <span
                              key={index}
                              className={`h-1.5 w-8 rounded-full transition ${index < passwordScore ? 'bg-gradient-to-r from-cyan-300 via-blue-400 to-violet-400 shadow-[0_0_12px_rgba(96,165,250,0.55)]' : 'bg-white/10'}`}
                            />
                          ))}
                        </div>
                      </div>
                      <ul className="mt-3 space-y-2 text-sm text-white/62">
                        {PASSWORD_HINTS.map((hint) => (
                          <li key={hint} className="flex items-center gap-2">
                            <Check className={`h-4 w-4 ${password.length >= 8 ? 'text-emerald-300' : 'text-white/25'}`} />
                            {hint}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </>
                ) : null}

                {mode === 'login' ? (
                  <div className="flex items-center justify-between gap-3 pt-1 text-sm">
                    <span className="text-white/50">Need a reset?</span>
                    <button
                      type="button"
                      onClick={() => void handleForgotPassword()}
                      disabled={busy !== null}
                      className="font-medium text-cyan-200 transition hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Forgot password
                    </button>
                  </div>
                ) : null}

                <button
                  type="submit"
                  disabled={busy !== null}
                  className="group inline-flex w-full items-center justify-center gap-2 rounded-[20px] bg-[linear-gradient(135deg,#8b5cf6_0%,#2563eb_48%,#22d3ee_100%)] px-4 py-4 text-sm font-semibold text-white shadow-[0_18px_45px_rgba(37,99,235,0.35)] transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_24px_60px_rgba(37,99,235,0.45)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy === 'login' || busy === 'signup' || busy === 'reset' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {mode === 'login' ? 'Sign in' : 'Create account'}
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                </button>

                <div className="relative py-1">
                  <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-transparent via-white/12 to-transparent" />
                  <div className="relative mx-auto w-fit rounded-full border border-white/10 bg-[#0a1020] px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-white/45">
                    or continue with
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => void run('google', signInWithGoogle)}
                  disabled={busy !== null}
                  className="flex w-full items-center justify-center gap-2 rounded-[20px] border border-white/12 bg-white/4 px-4 py-4 text-sm font-medium text-white/80 shadow-[0_10px_30px_rgba(0,0,0,0.2)] transition duration-300 hover:-translate-y-0.5 hover:border-white/18 hover:bg-white/6 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy === 'google' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4 text-cyan-200" />}
                  Continue with Google
                </button>

                <div className="pt-2 text-sm text-white/62">
                  {mode === 'login' ? (
                    <p>
                      New here?{' '}
                      <Link href="/signup" className="font-medium text-accent-200 transition hover:text-accent-100">
                        Create account
                      </Link>
                    </p>
                  ) : (
                    <p>
                      Already have access?{' '}
                      <Link href="/login" className="font-medium text-accent-200 transition hover:text-accent-100">
                        Sign in
                      </Link>
                    </p>
                  )}
                </div>

                {message ? (
                  <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-3 text-sm text-emerald-100">
                    {message}
                  </div>
                ) : null}

                {error ? (
                  <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 p-3 text-sm text-rose-100">
                    {error}
                  </div>
                ) : null}
              </form>
            </div>
          </M.section>
        </div>
      </div>
    </div>
  );
}
