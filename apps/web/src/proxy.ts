import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { auth } from '@/lib/auth/authjs'
import { SignJWT } from 'jose'

const API_BACKEND = process.env.API_BACKEND_URL ?? 'http://localhost:3001'

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Proxy /api/* (except /api/auth/*) to Express backend
  // Create a signed HS256 JWT from the Auth.js session for Express requireAuth
  if (pathname.startsWith('/api') && !pathname.startsWith('/api/auth')) {
    const url = new URL(pathname + request.nextUrl.search, API_BACKEND)
    const headers = new Headers(request.headers)

    const session = await auth()
    if (session?.user) {
      const secret = process.env.AUTH_SECRET
      if (secret) {
        const secretBytes = new TextEncoder().encode(secret)
        const jwt = await new SignJWT({
          sub: session.user.id ?? '',
          tenantId: session.user.tenantId,
          role: session.user.role,
          vertical: session.user.vertical,
          businessName: session.user.businessName,
          subscriptionStatus: session.user.subscriptionStatus,
        })
          .setProtectedHeader({ alg: 'HS256' })
          .setIssuedAt()
          .setExpirationTime('60s')
          .sign(secretBytes)

        headers.set('Authorization', `Bearer ${jwt}`)
      }
    }

    return NextResponse.rewrite(url, { request: { headers } })
  }

  // Clerk handles /demo/* routes via (demo) layout
  if (pathname.startsWith('/demo')) {
    return NextResponse.next()
  }

  // Auth.js protects all app routes
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

    if (session.user.subscriptionStatus === 'canceled' && !pathname.startsWith('/settings')) {
      return NextResponse.redirect(new URL('/settings/billing', request.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
