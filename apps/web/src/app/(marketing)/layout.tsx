import MarketingNav from '@/components/MarketingNav'

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      <MarketingNav />

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
