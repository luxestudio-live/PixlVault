import { GuestOnly } from '@/components/routes/guest-only';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <GuestOnly>
      <div className="relative min-h-screen overflow-hidden bg-[#050814]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(111,92,255,0.16),transparent_26%),radial-gradient(circle_at_top_right,rgba(40,160,255,0.14),transparent_24%),radial-gradient(circle_at_bottom,rgba(20,184,166,0.08),transparent_30%)]" />
        <div className="pointer-events-none absolute left-1/2 top-0 h-72 w-[42rem] -translate-x-1/2 rounded-full bg-violet-500/10 blur-3xl" />
        {children}
      </div>
    </GuestOnly>
  );
}
