import { AppShell } from '@/components/app-shell';
import { AppAccessGuard } from '@/components/routes/app-access-guard';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppAccessGuard>
      <AppShell>{children}</AppShell>
    </AppAccessGuard>
  );
}
