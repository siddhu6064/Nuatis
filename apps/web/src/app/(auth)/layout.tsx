import MarketingNav from '@/components/MarketingNav'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-white">
      <MarketingNav />

      {/* Auth pages set their own min-h + centering; flex-1 lets the
          subtle footer sit naturally at the bottom of short forms. */}
      <main className="flex-1">{children}</main>

      <footer className="border-t border-border-brand bg-bg">
        <div className="max-w-6xl mx-auto px-6 py-4 text-center text-xs text-ink4">
          Nuatis LLC &middot; Front Office AI &middot; &copy; 2026
        </div>
      </footer>
    </div>
  )
}
