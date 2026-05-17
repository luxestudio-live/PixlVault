import { AppAccessGuard } from '@/components/routes/app-access-guard';

export default function ViewerLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppAccessGuard>
      <div className="min-h-screen bg-black text-white">{children}</div>
    </AppAccessGuard>
  );
}
