import Link from 'next/link'

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <header className="border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/products" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-teal-600 flex items-center justify-center">
              <span className="text-white text-xs font-bold">N</span>
            </div>
            <span className="text-sm font-bold text-gray-900">Nuatis</span>
          </Link>
          <nav className="hidden md:flex items-center gap-6 text-sm text-gray-500">
            <Link href="/maya#features" className="hover:text-gray-900">
              Features
            </Link>
            <Link href="/maya#pricing" className="hover:text-gray-900">
              Pricing
            </Link>
            <Link href="/maya#how-it-works" className="hover:text-gray-900">
              How It Works
            </Link>
            <Link href="/sign-in" className="hover:text-gray-900">
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
      <footer className="border-t border-gray-100 bg-gray-50">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded bg-teal-600 flex items-center justify-center">
                <span className="text-white text-[9px] font-bold">N</span>
              </div>
              <span className="text-xs text-gray-400">Nuatis LLC &middot; Austin, TX</span>
            </div>
            <div className="flex items-center gap-4 text-xs text-gray-400">
              <a href="https://nuatis.com" className="hover:text-gray-600">
                nuatis.com
              </a>
              <span>&middot;</span>
              <a href="mailto:sid@nuatis.com" className="hover:text-gray-600">
                Contact
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
