'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/insights', label: 'Overview' },
  { href: '/insights/appointments', label: 'Appointments' },
  { href: '/insights/velocity', label: 'Velocity' },
]

export default function InsightsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  return (
    <div>
      <div className="sticky top-12 z-10 bg-white border-b border-border-brand">
        <div className="px-8 flex gap-0">
          {TABS.map(({ href, label }) => {
            const active =
              href === '/insights' ? pathname === '/insights' : pathname.startsWith(href)
            return (
              <Link
                key={href}
                href={href}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  active
                    ? 'border-teal-600 text-teal-700'
                    : 'border-transparent text-ink3 hover:text-ink2'
                }`}
              >
                {label}
              </Link>
            )
          })}
        </div>
      </div>
      {children}
    </div>
  )
}
