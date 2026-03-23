import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { auth } from '@/lib/auth/authjs'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // ── Clerk handles /demo/* routes ──────────────────────────
  // Clerk middleware runs separately via clerkMiddleware in
  // apps/web/src/app/(demo)/layout.tsx — nothing to do here.
  if (pathname.startsWith('/demo')) {
    return NextResponse.next()
  }

  // ── Auth.js handles all /(app)/* routes ───────────────────
  if (
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/contacts') ||
    pathname.startsWith('/pipeline') ||
    pathname.startsWith('/appointments') ||
    pathname.startsWith('/settings')
  ) {
    const session = await auth()

    if (!session) {
      const signInUrl = new URL('/sign-in', request.url)
      signInUrl.searchParams.set('callbackUrl', pathname)
      return NextResponse.redirect(signInUrl)
    }

    // Block inactive subscriptions (except settings so they can manage billing)
    if (session.user.subscriptionStatus === 'canceled' && !pathname.startsWith('/settings')) {
      return NextResponse.redirect(new URL('/settings/billing', request.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
