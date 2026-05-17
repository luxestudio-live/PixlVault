export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-mesh-gradient text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </div>
    </main>
  );
}
