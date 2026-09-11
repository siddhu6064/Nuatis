import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { POS_COOKIE, readPosSession, isExpired } from './session.js'

export interface PosProxyOptions {
  /** Where to send an unauthenticated page request, e.g. '/sign-in'. */
  signInPath: string
}

const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE']

/**
 * Shared POS middleware for apps/pos and apps/kds.
 *
 * Mirrors apps/web/src/proxy.ts, with one deliberate difference: apps/web mints
 * a fresh 60s JWT from the Auth.js session on every request, whereas a register
 * has no Auth.js session — it holds a 12h token minted by
 * POST /api/pos/terminal/sign-in, kept in an httpOnly cookie. The proxy reads
 * that cookie server-side and attaches the token, so it never reaches the
 * browser's JavaScript and the API's single-origin CORS never comes into play.
 *
 * Lives in a package rather than being copied into both apps: two copies of a
 * CSRF check is how one of them quietly loses a branch.
 */
export function createPosProxy(opts: PosProxyOptions) {
  return async function posProxy(request: NextRequest): Promise<NextResponse> {
    const { pathname } = request.nextUrl

    if (pathname.startsWith('/api')) {
      // CSRF first, and deliberately before any session check — including for
      // /api/session below. Two reasons: the sign-in endpoint sets a cookie and
      // so must be protected like any other mutation, and returning 403 before
      // 401 means the status never reveals whether a register is signed in.
      const origin = request.headers.get('origin')
      const fwdHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
      const fwdProto = request.headers.get('x-forwarded-proto') ?? 'https'
      const expectedOrigin = fwdHost ? `${fwdProto}://${fwdHost}` : request.nextUrl.origin
      if (MUTATING_METHODS.includes(request.method) && origin && origin !== expectedOrigin) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      // The app's own session endpoint performs the PIN exchange and sets the
      // cookie. It must not be proxied to the API or gated on having a session
      // — it is how you get one.
      if (pathname.startsWith('/api/session')) {
        return NextResponse.next()
      }

      const session = readPosSession(request.cookies.get(POS_COOKIE)?.value)
      if (!session || isExpired(session)) {
        // 401 rather than a redirect: these are fetch() calls, and the client
        // turns a 401 into a trip to the PIN screen itself.
        return NextResponse.json({ error: 'No register session' }, { status: 401 })
      }

      const API_BACKEND = process.env['API_BACKEND_URL'] ?? 'http://localhost:3001'
      const url = new URL(pathname + request.nextUrl.search, API_BACKEND)
      const headers = new Headers(request.headers)
      headers.set('Authorization', `Bearer ${session.token}`)
      // The API has no use for the register cookie, and forwarding a credential
      // further than it needs to go is how it ends up in someone's access log.
      headers.delete('cookie')
      return NextResponse.rewrite(url, { request: { headers } })
    }

    // Page requests: anything but the sign-in screen needs a live session.
    if (!pathname.startsWith(opts.signInPath)) {
      const session = readPosSession(request.cookies.get(POS_COOKIE)?.value)
      if (!session || isExpired(session)) {
        const url = request.nextUrl.clone()
        url.pathname = opts.signInPath
        return NextResponse.redirect(url)
      }
    }

    return NextResponse.next()
  }
}
