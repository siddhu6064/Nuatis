import { describe, it, expect, beforeEach } from '@jest/globals'
import { jwtVerify, decodeJwt } from 'jose'
import { createSocketTicketRoute } from './socket-ticket-route.js'
import { POS_COOKIE, serializePosSession, type PosSession } from './session.js'

const SECRET = 'test-secret-for-unit-tests-only-32ch'
const SESSION_TOKEN = 'the.twelve.hour.session.token'

function session(overrides: Partial<PosSession> = {}): PosSession {
  return {
    token: SESSION_TOKEN,
    tenantId: 'tenant-1',
    locationId: 'loc-1',
    staffId: 'staff-1',
    staffName: 'Dana',
    expiresAt: Date.now() + 60_000,
    ...overrides,
  }
}

function get(cookie?: string): Request {
  return new Request('http://localhost:3003/api/socket-ticket', {
    headers: cookie ? { cookie } : {},
  })
}

function cookieFor(s: PosSession): string {
  return `${POS_COOKIE}=${encodeURIComponent(serializePosSession(s))}`
}

const { GET } = createSocketTicketRoute()

beforeEach(() => {
  process.env['AUTH_SECRET'] = SECRET
})

describe('GET /api/socket-ticket', () => {
  it('mints a ticket bound to the session tenant and location', async () => {
    const res = await GET(get(cookieFor(session())))
    expect(res.status).toBe(200)

    const body = (await res.json()) as { token: string; tenantId: string; locationId: string }
    expect(body.tenantId).toBe('tenant-1')
    expect(body.locationId).toBe('loc-1')

    const { payload } = await jwtVerify(body.token, new TextEncoder().encode(SECRET), {
      algorithms: ['HS256'],
      issuer: 'nuatis-web',
      audience: 'nuatis-api',
    })
    expect(payload['tenantId']).toBe('tenant-1')
    expect(payload['locationId']).toBe('loc-1')
  })

  it('never returns the 12h session token', async () => {
    const res = await GET(get(cookieFor(session())))
    const raw = await res.text()
    expect(raw).not.toContain(SESSION_TOKEN)
  })

  it('expires the ticket in about a minute, not in twelve hours', async () => {
    const res = await GET(get(cookieFor(session())))
    const { token } = (await res.json()) as { token: string }

    const claims = decodeJwt(token)
    const lifetime = (claims.exp ?? 0) - (claims.iat ?? 0)
    expect(lifetime).toBe(60)
  })

  it('carries no portalScope or role — it is not meant to reach an HTTP route', async () => {
    const res = await GET(get(cookieFor(session())))
    const { token } = (await res.json()) as { token: string }

    const claims = decodeJwt(token)
    expect(claims['portalScope']).toBeUndefined()
    expect(claims['role']).toBeUndefined()
  })

  it('is never cached — a ticket in a shared cache is a ticket given away', async () => {
    const res = await GET(get(cookieFor(session())))
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('401s with no cookie', async () => {
    const res = await GET(get())
    expect(res.status).toBe(401)
  })

  it('401s on a malformed cookie rather than minting anything', async () => {
    const res = await GET(get(`${POS_COOKIE}=not-json`))
    expect(res.status).toBe(401)
  })

  it('401s on an expired session, so a dead shift cannot keep watching', async () => {
    const res = await GET(get(cookieFor(session({ expiresAt: Date.now() - 1 }))))
    expect(res.status).toBe(401)
  })

  it('fails closed when AUTH_SECRET is missing', async () => {
    delete process.env['AUTH_SECRET']
    const res = await GET(get(cookieFor(session())))
    expect(res.status).toBe(500)
  })

  it('reads its cookie out of a header carrying several', async () => {
    const cookie = `other=1; ${cookieFor(session())}; another=2`
    const res = await GET(get(cookie))
    expect(res.status).toBe(200)
  })
})
