import Link from 'next/link';
import { ArrowRight, Sparkles } from 'lucide-react';

export default function MarketingPage() {
  return (
    <div className="flex min-h-screen flex-col justify-between gap-8 py-6 sm:py-8 lg:py-10">
      <header className="flex items-center justify-between gap-4">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] uppercase tracking-[0.28em] text-accent-200">
          <Sparkles className="h-3.5 w-3.5" />
          PixlVault
        </div>

        <div className="flex items-center gap-2">
          <Link href="/login" className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/78 transition hover:bg-white/10">
            Sign in
          </Link>
          <Link href="/signup" className="rounded-full bg-accent-400 px-4 py-2 text-sm font-semibold text-ink-900 transition hover:bg-accent-300">
            Get started
          </Link>
        </div>
      </header>

      <section className="grid items-center gap-8 py-10 lg:grid-cols-[1.02fr_0.98fr] lg:py-14">
        <div className="max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.26em] text-white/58">
            Encrypted media cloud
          </div>
          <h1 className="mt-6 font-[family-name:var(--font-space-grotesk)] text-5xl font-semibold tracking-tight sm:text-6xl lg:text-7xl">
            Your media,
            <span className="block bg-[linear-gradient(135deg,#ffffff_0%,#9be7ff_38%,#8b5cf6_100%)] bg-clip-text text-transparent">
              dressed like a premium app.
            </span>
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-white/68 sm:text-lg">
            PixlVault opens with a calm surface and takes you straight into login, signup, or the gallery.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/signup" className="inline-flex items-center gap-2 rounded-full bg-[linear-gradient(135deg,#8b5cf6_0%,#2563eb_48%,#22d3ee_100%)] px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_45px_rgba(37,99,235,0.35)] transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_24px_60px_rgba(37,99,235,0.45)]">
              Start free
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/login" className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm text-white/80 transition hover:bg-white/10">
              Sign in
            </Link>
            <Link href="/app/gallery" className="inline-flex items-center gap-2 rounded-full border border-white/10 px-5 py-3 text-sm text-white/60 transition hover:bg-white/5 hover:text-white/80">
              Enter gallery
            </Link>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-[38px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.07),rgba(255,255,255,0.03))] p-5 shadow-[0_24px_90px_rgba(0,0,0,0.42)] backdrop-blur-xl sm:p-6">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.18),transparent_28%),radial-gradient(circle_at_bottom_left,rgba(129,140,248,0.16),transparent_26%)]" />

          <div className="relative grid gap-4">
            <div className="rounded-[28px] border border-white/10 bg-black/18 p-4">
              <div className="grid grid-cols-[1fr_auto] items-end gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.24em] text-white/42">Live preview</p>
                  <h2 className="mt-2 font-[family-name:var(--font-space-grotesk)] text-2xl font-semibold tracking-tight">A calmer way to enter your workspace</h2>
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.2em] text-white/55">
                  Secure by design
                </div>
              </div>

              <div className="mt-5 grid grid-cols-3 gap-2">
                <div className="aspect-[4/5] rounded-3xl bg-[linear-gradient(180deg,rgba(99,102,241,0.82),rgba(11,16,34,0.18))] shadow-[0_18px_60px_rgba(71,85,255,0.24)]" />
                <div className="mt-3 aspect-[4/5] rounded-3xl bg-[linear-gradient(180deg,rgba(34,197,94,0.42),rgba(11,16,34,0.14))]" />
                <div className="aspect-[4/5] rounded-3xl bg-[linear-gradient(180deg,rgba(56,189,248,0.56),rgba(11,16,34,0.18))] shadow-[0_18px_60px_rgba(34,211,238,0.18)]" />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {[
                'Encrypted vault',
                'Telegram handoff',
                'Fullscreen viewer',
              ].map((item) => (
                <div key={item} className="rounded-3xl border border-white/8 bg-black/18 px-4 py-3 text-sm text-white/68 backdrop-blur-md">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
