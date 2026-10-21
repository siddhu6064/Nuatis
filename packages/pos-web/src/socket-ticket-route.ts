import { NextResponse } from 'next/server'
import { SignJWT } from 'jose'
import { POS_COOKIE, readPosSession, isExpired } from './session'

/**
 * How long a socket ticket is good for.
 *
 * The socket authenticates once, at handshake, and never re-checks — so this
 * only has to cover the round trip from mint to connect, not the life of the
 * connection. Sixty seconds is the same window apps/web mints its per-request
 * JWTs for.
 */
const TICKET_LIFETIME = '60s'

export interface SocketTicketRoute {
  GET: (request: Request) => Promise<NextResponse>
}

/**
 * Mints a short-lived ticket for the POS WebSocket.
 *
 * A browser WebSocket connects to the API host directly. Unlike a fetch(), the
 * upgrade cannot be rewritten by the proxy, so the client genuinely needs a
 * credential in JavaScript — there is no way around that.
 *
 * What it must NOT get is the 12-hour session token. That token is httpOnly
 * precisely so an XSS bug cannot walk off with a working register credential,
 * and handing it to `fetch('/api/socket-ticket')` would undo that for the price
 * of one line of injected script.
 *
 * So this mints its own token instead, from the same AUTH_SECRET, bound to the
 * session's tenant and location and expiring in a minute. lib/pos-ws.ts already
 * accepts exactly this shape (HS256, iss nuatis-web, aud nuatis-api, matching
 * tenantId, and a locationId that must match the channel being joined), so no
 * new API endpoint is needed. A stolen ticket is worthless within sixty seconds
 * and, even inside that window, can only ever join one location's ticket feed —
 * it carries no portalScope and therefore reaches no HTTP route at all.
 */
export function createSocketTicketRoute(): SocketTicketRoute {
  async function GET(request: Request): Promise<NextResponse> {
    const cookie = readCookie(request.headers.get('cookie'), POS_COOKIE)
    const session = readPosSession(cookie)

    if (!session || isExpired(session)) {
      return NextResponse.json({ error: 'No register session' }, { status: 401 })
    }

    const secret = process.env['AUTH_SECRET']
    if (!secret) {
      // Fail closed and say so in the log, not the response: a client that
      // cannot tell misconfiguration from expiry will simply retry forever.
      console.error('[socket-ticket] AUTH_SECRET is not set; cannot mint a socket ticket')
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
    }

    const token = await new SignJWT({
      tenantId: session.tenantId,
      // pos-ws refuses a token whose locationId does not match the channel, so
      // this is the line that makes a kitchen screen unable to watch a sibling
      // location's tickets.
      locationId: session.locationId,
      // Deliberately no portalScope and no role: this token exists only to
      // pass the socket handshake. requireAuth would let a scope-less token
      // reach any HTTP route, so the mitigation is its sixty-second life plus
      // the fact that it is never sent anywhere but the socket.
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setIssuer('nuatis-web')
      .setAudience('nuatis-api')
      .setExpirationTime(TICKET_LIFETIME)
      .sign(new TextEncoder().encode(secret))

    return NextResponse.json(
      {
        token,
        tenantId: session.tenantId,
        locationId: session.locationId,
      },
      // Never cached, anywhere. A ticket in a shared cache is a ticket handed
      // to whoever asks next.
      { headers: { 'cache-control': 'no-store' } }
    )
  }

  return { GET }
}

/** Pull one cookie out of a raw Cookie header. */
function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() !== name) continue
    return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return undefined
}
