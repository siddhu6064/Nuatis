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
    // CSRF-01: for state-mutating methods, reject cross-origin requests. The
    // browser always sends Origin on these; a same-origin call matches the app's
    // own origin. Absent Origin (server-side / same-origin navigation) is allowed.
    const origin = request.headers.get('origin')
    // Behind the prod reverse proxy, request.nextUrl.origin reflects the internal
    // host, not the public domain — compare against the forwarded public origin.
    const fwdHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
    const fwdProto = request.headers.get('x-forwarded-proto') ?? 'https'
    const expectedOrigin = fwdHost ? `${fwdProto}://${fwdHost}` : request.nextUrl.origin
    if (
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) &&
      origin &&
      origin !== expectedOrigin
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const url = new URL(pathname + request.nextUrl.search, API_BACKEND)
    const headers = new Headers(request.headers)

    const session = await auth()
    if (session?.user) {
      const secret = process.env.AUTH_SECRET
      if (secret) {
        const secretBytes = new TextEncoder().encode(secret)
        const jwt = await new SignJWT({
          sub: session.user.id || undefined,
          tenantId: session.user.tenantId,
          role: session.user.role,
          vertical: session.user.vertical,
          businessName: session.user.businessName,
          subscriptionStatus: session.user.subscriptionStatus,
        })
          .setProtectedHeader({ alg: 'HS256' })
          .setIssuedAt()
          .setIssuer('nuatis-web')
          .setAudience('nuatis-api')
          .setExpirationTime('60s')
          .sign(secretBytes)

        headers.set('Authorization', `Bearer ${jwt}`)
      }
    }

    return NextResponse.rewrite(url, { request: { headers } })
  }

  // Auth.js protects every app route. This is an allowlist of PUBLIC prefixes,
  // deliberately inverted: a route added to the dashboard is protected by
  // default. The previous denylist named only five prefixes, so 20 dashboard
  // routes (/calls, /deals, /invoices, /campaigns, …) rendered unauthenticated
  // and bypassed the canceled-subscription redirect below.
  const PUBLIC_PREFIXES = [
    // Auth.js's own endpoints. The /api rewrite above deliberately skips
    // /api/auth, so these fall through to here — gating them would redirect the
    // sign-in flow to /sign-in and make login impossible.
    '/api/auth',
    // (auth)
    '/sign-in',
    '/sign-up',
    '/forgot-password',
    '/reset-password',
    // (marketing)
    '/pricing',
    '/products',
    '/maya',
    // (demo)
    '/demo',
    // (public) — customer-facing, no dashboard session
    '/collect', // /collect/[slug] intake forms
    '/portal', // /portal/[slug] client portal (own auth)
    '/book', // /book/[slug] public booking
    // Public quote view. Must stay narrower than '/quotes', which is a
    // protected dashboard route (/quotes, /quotes/ledger, /quotes/payment-links).
    '/quotes/view',
    '/widget', // embeddable webchat widget, loaded from customer sites
  ]

  // Files under apps/web/public (manifest.json, sw.js, icons/*, *.png) still
  // reach this middleware — the matcher below only exempts _next/static,
  // _next/image and favicon.ico. Gating them would break the PWA manifest and
  // the sign-in page's own logo, so exempt anything with a file extension.
  const isStaticAsset = /\.[a-z0-9]+$/i.test(pathname)

  const isPublic =
    pathname === '/' ||
    isStaticAsset ||
    PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))

  if (!isPublic) {
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
