'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: '▦' },
  { href: '/contacts', label: 'Contacts', icon: '◎' },
  { href: '/pipeline', label: 'Pipeline', icon: '◈' },
  { href: '/appointments', label: 'Appointments', icon: '◷' },
  { href: '/voice', label: 'Voice AI', icon: '◉', soon: true },
  { href: '/settings', label: 'Settings', icon: '◌' },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname()

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 bg-white border-r border-gray-100 flex flex-col shrink-0">
        {/* Brand */}
        <div className="px-5 py-5 border-b border-gray-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center shrink-0">
              <span className="text-white text-sm font-bold">N</span>
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900 leading-none">Nuatis</p>
              <p className="text-[10px] text-gray-400 mt-0.5 leading-none">Front Office AI</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {NAV.map(({ href, label, icon, soon }) => {
            const active = path === href || path.startsWith(href + '/')
            return (
              <Link
                key={href}
                href={soon ? '#' : href}
                className={`
                  flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors
                  ${
                    active
                      ? 'bg-teal-50 text-teal-700 font-medium'
                      : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                  }
                  ${soon ? 'opacity-50 cursor-not-allowed' : ''}
                `}
              >
                <span className="text-base leading-none">{icon}</span>
                <span>{label}</span>
                {soon && (
                  <span className="ml-auto text-[9px] bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded font-medium">
                    SOON
                  </span>
                )}
              </Link>
            )
          })}
        </nav>

        {/* User footer */}
        <div className="px-4 py-4 border-t border-gray-100">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-teal-100 flex items-center justify-center shrink-0">
              <span className="text-teal-700 text-xs font-bold">S</span>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-gray-900 truncate">Nuatis LLC</p>
              <p className="text-[10px] text-gray-400 truncate">sid@nuatis.com</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  )
}
