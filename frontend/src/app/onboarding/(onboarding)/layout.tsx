import { AppAccessGuard } from '@/components/routes/app-access-guard';

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppAccessGuard>
      <div className="min-h-screen bg-ink-900 text-white">{children}</div>
    </AppAccessGuard>
  );
}
