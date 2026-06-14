'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'

/**
 * Top-of-page nav used by both the (marketing) and (auth) layouts.
 *
 * Brochure-style links point at nuatis.com (open in new tab) so the
 * SPA shell isn't replaced by static content; in-app destinations
 * (pricing, sign-in, sign-up) stay client-side.
 *
 * The "Sign In" item auto-hides when the current route already is
 * /sign-in, so callers don't need to thread a prop through.
 */
export default function MarketingNav() {
  const pathname = usePathname() ?? ''
  const onSignIn = pathname.startsWith('/sign-in')

  return (
    <header className="border-b border-border-brand bg-white">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link href="/products" className="flex items-center gap-2">
          <Image
            src="/nuatis-lockup-teal.png"
            alt="Nuatis"
            width={120}
            height={38}
            priority
            className="object-contain"
          />
        </Link>
        <nav className="hidden md:flex items-center gap-6 text-sm text-ink3">
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
          {!onSignIn && (
            <Link href="/sign-in" className="hover:text-ink">
              Sign In
            </Link>
          )}
          <Link
            href="/sign-up?product=maya_only"
            className="px-4 py-2 bg-teal-600 text-white rounded-lg font-medium hover:bg-teal-700 transition-colors"
          >
            Start Free Trial
          </Link>
        </nav>
      </div>
    </header>
  )
}
