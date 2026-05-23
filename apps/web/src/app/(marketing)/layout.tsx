import Link from 'next/link'

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <header className="border-b border-border-brand">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/products" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-teal-600 flex items-center justify-center">
              <span className="text-white text-xs font-bold">N</span>
            </div>
            <span className="text-sm font-bold text-ink">Nuatis</span>
          </Link>
          <nav className="hidden md:flex items-center gap-6 text-sm text-ink3">
            {/* Marketing nav points at the nuatis.com brochure site for
                product content; pricing + auth stay inside the app. */}
            <a
              href="https://nuatis.com/modules.html"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-ink"
            >
              Features
            </a>
            <Link href="/pricing" className="hover:text-ink">
              Pricing
            </Link>
            <a
              href="https://nuatis.com/why-maya.html"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-ink"
            >
              How It Works
            </a>
            <Link href="/sign-in" className="hover:text-ink">
              Sign In
            </Link>
            <Link
              href="/sign-up?product=maya_only"
              className="px-4 py-2 bg-teal-600 text-white rounded-lg font-medium hover:bg-teal-700 transition-colors"
            >
              Start Free Trial
            </Link>
          </nav>
        </div>
      </header>

      {children}

      {/* Footer */}
      <footer className="border-t border-border-brand bg-bg">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded bg-teal-600 flex items-center justify-center">
                <span className="text-white text-[9px] font-bold">N</span>
              </div>
              <span className="text-xs text-ink4">Nuatis LLC &middot; Austin, TX</span>
            </div>
            <div className="flex items-center gap-4 text-xs text-ink4">
              <a href="https://nuatis.com" className="hover:text-ink3">
                nuatis.com
              </a>
              <span>&middot;</span>
              <a href="mailto:sid@nuatis.com" className="hover:text-ink3">
                Contact
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
