'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import Image from 'next/image'
import { SessionProvider, signOut } from 'next-auth/react'

function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname()
  const active = pathname === href
  return (
    <Link
      href={href}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
        active ? 'bg-teal-50 text-teal-700' : 'text-ink3 hover:bg-bg'
      }`}
    >
      {label}
    </Link>
  )
}

export default function StaffPortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <div className="min-h-screen bg-bg">
        <header className="flex items-center justify-between px-4 py-3 border-b border-border-brand bg-white">
          <div className="flex items-center gap-6">
            <Image src="/nuatis-lockup-teal.png" width={110} height={34} alt="Nuatis" priority />
            <nav className="flex items-center gap-1">
              <NavLink href="/staff-portal" label="My Schedule" />
              <NavLink href="/staff-portal/timesheet" label="Timesheet" />
              <NavLink href="/staff-portal/time-off" label="Time Off" />
            </nav>
          </div>
          <button
            type="button"
            onClick={() => void signOut({ callbackUrl: '/sign-in' })}
            className="text-sm text-ink3 hover:text-ink transition-colors"
          >
            Sign out
          </button>
        </header>
        <main className="max-w-3xl mx-auto px-4 py-6">{children}</main>
      </div>
    </SessionProvider>
  )
}
