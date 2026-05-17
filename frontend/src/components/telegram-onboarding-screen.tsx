"use client";

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, Loader2, LockKeyhole, RotateCcw, Send, Sparkles, Smartphone, ShieldCheck } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useRouter, useSearchParams } from 'next/navigation';

import { useAuth } from '@/components/auth-provider';
import { fetchTelegramStatus, requestTelegramOtp, verifyTelegramOtp } from '@/lib/api';

const M: any = motion;

type Step = 'phone' | 'otp' | 'success';

export function TelegramOnboardingScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { getIdToken } = useAuth();

  const [step, setStep] = useState<Step>('phone');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [channelName, setChannelName] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [twoFactorPassword, setTwoFactorPassword] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [resendCooldownSeconds, setResendCooldownSeconds] = useState(0);
  const [otpValidSeconds, setOtpValidSeconds] = useState<number | null>(null);
  const otpActionLockRef = useRef(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const token = await getIdToken();
      if (!token) {
        router.replace('/login');
        return;
      }

      const status = await fetchTelegramStatus(token).catch(() => ({ linked: false, reconnect_required: false }));
      if (!active) {
        return;
      }
      if (status.linked) {
        setStep('success');
        setMessage(null);
        return;
      }

      if (status.reconnect_required) {
        setMessage('Telegram session expired or was revoked. Reconnect required.');
      } else if (searchParams.get('reason') === 'telegram-not-linked') {
        setMessage('Telegram is not linked yet. Connect your account to continue.');
      }
    })();

    return () => {
      active = false;
    };
  }, [getIdToken, router, searchParams]);

  useEffect(() => {
    if (resendCooldownSeconds <= 0) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setResendCooldownSeconds((seconds) => {
        if (seconds <= 1) {
          window.clearInterval(timer);
          return 0;
        }

        return seconds - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [resendCooldownSeconds]);

  const sendOtp = async (successMessage = 'OTP sent. Enter the code from Telegram.', forceResend = false) => {
    if (otpActionLockRef.current) {
      return;
    }

    otpActionLockRef.current = true;
    try {
      const token = await getIdToken();
      if (!token || !phoneNumber) {
        return;
      }

      setBusy('send-otp');
      setMessage(null);
      const response = await requestTelegramOtp(token, phoneNumber, forceResend, channelName.trim() || undefined);
      setChallengeId(response.challenge_id);
      setStep('otp');
      setMessage(successMessage);
      setResendCooldownSeconds(30);
      setOtpValidSeconds(response.expires_in_seconds ?? null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not send OTP.');
    } finally {
      setBusy(null);
      otpActionLockRef.current = false;
    }
  };

  const resendOtp = async () => {
    if (!phoneNumber) {
      return;
    }

    setOtpCode('');
    await sendOtp('Fresh OTP sent. Enter the new code from Telegram.', true);
  };

  useEffect(() => {
    if (step !== 'otp' || otpValidSeconds === null || otpValidSeconds <= 0) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setOtpValidSeconds((seconds) => {
        if (seconds === null) {
          return null;
        }

        if (seconds <= 1) {
          window.clearInterval(timer);
          return 0;
        }

        return seconds - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [step, otpValidSeconds]);

  const verifyOtp = async () => {
    if (otpActionLockRef.current) {
      return;
    }

    otpActionLockRef.current = true;
    try {
      const token = await getIdToken();
      if (!token || !challengeId || !otpCode) {
        return;
      }

      setBusy('verify-otp');
      setMessage(null);
      await verifyTelegramOtp(token, challengeId, otpCode, twoFactorPassword || undefined);
      setStep('success');
      setMessage('Telegram linked. Your gallery is ready.');
    } catch (error) {
      const fallbackMessage = 'Could not verify OTP. Request a fresh code if Telegram says it expired.';
      setMessage(error instanceof Error ? error.message : fallbackMessage);
    } finally {
      setBusy(null);
      otpActionLockRef.current = false;
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden px-4 py-6 text-white sm:px-6 lg:px-8 lg:py-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.12),transparent_24%),radial-gradient(circle_at_top_right,rgba(56,189,248,0.12),transparent_22%),radial-gradient(circle_at_bottom,rgba(129,140,248,0.14),transparent_30%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-44 bg-[linear-gradient(180deg,rgba(5,8,20,0.95),transparent)]" />

      <div className="relative mx-auto grid min-h-[calc(100vh-3rem)] w-full max-w-6xl items-stretch gap-5 lg:grid-cols-[0.9fr_1.1fr] lg:gap-6">
        <section className="relative hidden overflow-hidden rounded-[34px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.07),rgba(255,255,255,0.03))] p-8 shadow-[0_28px_90px_rgba(0,0,0,0.45)] backdrop-blur-xl lg:flex lg:flex-col lg:justify-between">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(45,212,191,0.14),transparent_28%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.12),transparent_26%)]" />
          <div className="relative z-10">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] uppercase tracking-[0.28em] text-accent-200">
              <Sparkles className="h-3.5 w-3.5" />
              Telegram onboarding
            </div>
            <h1 className="mt-6 max-w-md font-[family-name:var(--font-space-grotesk)] text-5xl font-semibold tracking-tight">
              Connect once, then drop straight into your gallery.
            </h1>
            <p className="mt-4 max-w-lg text-base leading-7 text-white/64">
              PixlVault uses your Telegram account as a private storage layer. We only need your phone, the OTP, and the session needed to create your channel.
            </p>
          </div>

          <div className="relative z-10 grid gap-3 text-sm text-white/72">
            {[
              { icon: ShieldCheck, title: 'Private by design', text: 'Your Telegram session is encrypted before it is stored.' },
              { icon: Smartphone, title: 'Fast verification', text: 'Phone number, OTP, and optional 2FA if your account requires it.' },
              { icon: LockKeyhole, title: 'One-time setup', text: 'After linking, future uploads go straight to your private channel.' },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="rounded-3xl border border-white/8 bg-black/18 p-4 backdrop-blur-md">
                  <div className="flex items-start gap-3">
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-2 text-accent-200">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="font-medium text-white">{item.title}</p>
                      <p className="mt-1 text-sm leading-6 text-white/60">{item.text}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="relative overflow-hidden rounded-[34px] border border-white/10 bg-[linear-gradient(180deg,rgba(10,14,28,0.94),rgba(7,10,18,0.98))] shadow-[0_28px_90px_rgba(0,0,0,0.55)] backdrop-blur-xl">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.14),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(129,140,248,0.1),transparent_30%)]" />
          <div className="relative z-10 flex h-full flex-col">
            <div className="border-b border-white/8 px-5 pb-4 pt-5 sm:px-7 sm:pb-5 sm:pt-6">
              <p className="text-[11px] uppercase tracking-[0.28em] text-white/42">Onboarding</p>
              <div className="mt-2 flex items-center justify-between gap-4">
                <div>
                  <h1 className="font-[family-name:var(--font-space-grotesk)] text-3xl font-semibold tracking-tight sm:text-4xl">Connect Telegram</h1>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-white/58">
                    This link turns Telegram into your private media backend, then sends you into the gallery.
                  </p>
                </div>
                <div className="hidden rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-white/55 sm:block">
                  Gallery-ready
                </div>
              </div>

              <div className="mt-5 flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-white/45">
                <span className={step === 'phone' ? 'text-accent-200' : ''}>Phone</span>
                <span>/</span>
                <span className={step === 'otp' ? 'text-accent-200' : ''}>OTP</span>
                <span>/</span>
                <span className={step === 'success' ? 'text-accent-200' : ''}>Done</span>
              </div>
            </div>

            <div className="relative z-10 flex-1 px-5 py-5 sm:px-7 sm:py-7">
              <AnimatePresence mode="wait">
                {step === 'phone' ? (
                  <M.div key="phone" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-5">
                    <label className="block space-y-2">
                      <span className="text-sm font-medium text-white/72">Channel name</span>
                      <input
                        value={channelName}
                        onChange={(event) => setChannelName(event.target.value)}
                        placeholder="My Private Vault"
                        maxLength={80}
                        className="auth-input"
                      />
                      <p className="text-xs leading-5 text-white/45">
                        Optional. If you skip it, the channel will be named PixlVault.
                      </p>
                    </label>

                    <label className="block space-y-2">
                      <span className="text-sm font-medium text-white/72">Phone number</span>
                      <input
                        value={phoneNumber}
                        onChange={(event) => setPhoneNumber(event.target.value)}
                        placeholder="+1 555 000 0000"
                        className="auth-input"
                      />
                    </label>

                    <button
                      type="button"
                      onClick={() => void sendOtp()}
                      disabled={busy === 'send-otp' || !phoneNumber}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-[20px] bg-[linear-gradient(135deg,#22c55e_0%,#14b8a6_48%,#06b6d4_100%)] px-4 py-4 text-sm font-semibold text-white shadow-[0_18px_45px_rgba(20,184,166,0.28)] transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_24px_60px_rgba(20,184,166,0.38)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {busy === 'send-otp' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      Send OTP
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </M.div>
                ) : null}

                {step === 'otp' ? (
                  <M.div key="otp" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-5">
                    <label className="block space-y-2">
                      <span className="text-sm font-medium text-white/72">OTP code</span>
                      <input
                        value={otpCode}
                        onChange={(event) => setOtpCode(event.target.value)}
                        placeholder="12345"
                        className="auth-input"
                      />
                    </label>

                    <label className="block space-y-2">
                      <span className="text-sm font-medium text-white/72">2FA password</span>
                      <input
                        type="password"
                        value={twoFactorPassword}
                        onChange={(event) => setTwoFactorPassword(event.target.value)}
                        placeholder="Only if Telegram asks for it"
                        className="auth-input"
                      />
                    </label>

                    <button
                      type="button"
                      onClick={() => void verifyOtp()}
                      disabled={busy === 'verify-otp' || !otpCode}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-[20px] bg-[linear-gradient(135deg,#8b5cf6_0%,#2563eb_48%,#22d3ee_100%)] px-4 py-4 text-sm font-semibold text-white shadow-[0_18px_45px_rgba(37,99,235,0.35)] transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_24px_60px_rgba(37,99,235,0.45)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {busy === 'verify-otp' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      Verify and continue
                    </button>

                    <button
                      type="button"
                      onClick={() => void resendOtp()}
                      disabled={busy === 'send-otp' || resendCooldownSeconds > 0}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-[20px] border border-white/10 bg-white/5 px-4 py-4 text-sm font-semibold text-white/78 transition duration-300 hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {busy === 'send-otp' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                      {resendCooldownSeconds > 0 ? `Resend in ${resendCooldownSeconds}s` : 'Resend code'}
                    </button>
                  </M.div>
                ) : null}

                {step === 'success' ? (
                  <M.div key="success" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="flex min-h-[320px] flex-col items-center justify-center rounded-[28px] border border-emerald-300/20 bg-emerald-400/10 p-6 text-center">
                    <CheckCircle2 className="h-12 w-12 text-emerald-200" />
                    <p className="mt-4 text-2xl font-semibold text-white">Telegram linked successfully</p>
                    <p className="mt-2 max-w-md text-sm leading-6 text-white/68">Your private channel is ready. PixlVault can now store and retrieve media through your Telegram account.</p>
                    <button
                      type="button"
                      onClick={() => router.replace('/app/gallery')}
                      className="mt-6 inline-flex items-center gap-2 rounded-full bg-emerald-400 px-5 py-3 text-sm font-semibold text-ink-900 transition hover:bg-emerald-300"
                    >
                      Enter gallery
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </M.div>
                ) : null}
              </AnimatePresence>

              {message ? (
                <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-white/72">{message}</div>
              ) : null}

              {step === 'otp' && otpValidSeconds !== null ? (
                <p className="mt-3 text-xs uppercase tracking-[0.2em] text-white/42">
                  Code valid for {otpValidSeconds}s · resend available in {resendCooldownSeconds}s
                </p>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
