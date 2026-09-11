import { describe, it, expect, beforeEach } from '@jest/globals'
import { NextRequest } from 'next/server'
import { createPosProxy } from './proxy.js'
import { POS_COOKIE, serializePosSession, type PosSession } from './session.js'

const proxy = createPosProxy({ signInPath: '/sign-in' })

function live(overrides: Partial<PosSession> = {}): string {
  return serializePosSession({
    token: 'jwt.goes.here',
    tenantId: 'tenant-1',
    locationId: 'loc-1',
    staffId: 'staff-1',
    staffName: 'Dana',
    expiresAt: Date.now() + 3_600_000,
    ...overrides,
  })
}

function req(
  path: string,
  opts: { method?: string; cookie?: string; origin?: string; host?: string } = {}
): NextRequest {
  const headers = new Headers()
  if (opts.cookie !== undefined) {
    headers.set('cookie', `${POS_COOKIE}=${encodeURIComponent(opts.cookie)}`)
  }
  if (opts.origin) headers.set('origin', opts.origin)
  headers.set('host', opts.host ?? 'pos.nuatis.com')
  headers.set('x-forwarded-proto', 'https')
  return new NextRequest(`https://pos.nuatis.com${path}`, {
    method: opts.method ?? 'GET',
    headers,
  })
}

beforeEach(() => {
  process.env['API_BACKEND_URL'] = 'http://localhost:3001'
})

describe('API forwarding', () => {
  it('rewrites to the API backend', async () => {
    const res = await proxy(req('/api/pos/menu/tree', { cookie: live() }))
    expect(res.headers.get('x-middleware-rewrite')).toContain('/api/pos/menu/tree')
  })

  it('attaches the cookie token as a bearer header', async () => {
    const res = await proxy(req('/api/pos/menu/tree', { cookie: live() }))
    expect(res.headers.get('x-middleware-request-authorization')).toBe('Bearer jwt.goes.here')
  })

  it('preserves the query string', async () => {
    const res = await proxy(req('/api/pos/tickets?location_id=loc-1', { cookie: live() }))
    expect(res.headers.get('x-middleware-rewrite')).toContain('location_id=loc-1')
  })

  it('401s an API call with no session rather than forwarding anonymously', async () => {
    const res = await proxy(req('/api/pos/menu/tree'))
    expect(res.status).toBe(401)
    expect(res.headers.get('x-middleware-rewrite')).toBeNull()
  })

  it('401s an API call whose session has expired', async () => {
    const res = await proxy(req('/api/pos/menu/tree', { cookie: live({ expiresAt: 1 }) }))
    expect(res.status).toBe(401)
  })

  it('401s an API call with a corrupt cookie', async () => {
    const res = await proxy(req('/api/pos/menu/tree', { cookie: 'not-json' }))
    expect(res.status).toBe(401)
  })

  it('does not forward the register cookie upstream', async () => {
    const res = await proxy(req('/api/pos/menu/tree', { cookie: live() }))
    expect(res.headers.get('x-middleware-request-cookie') ?? '').not.toContain(POS_COOKIE)
  })
})

describe('CSRF', () => {
  it('rejects a cross-origin POST', async () => {
    const res = await proxy(
      req('/api/pos/tickets/fire', {
        method: 'POST',
        cookie: live(),
        origin: 'https://evil.example',
      })
    )
    expect(res.status).toBe(403)
  })

  it('rejects a cross-origin DELETE', async () => {
    const res = await proxy(
      req('/api/pos/menu/items/x', {
        method: 'DELETE',
        cookie: live(),
        origin: 'https://evil.example',
      })
    )
    expect(res.status).toBe(403)
  })

  it('allows a same-origin POST', async () => {
    const res = await proxy(
      req('/api/pos/tickets/fire', {
        method: 'POST',
        cookie: live(),
        origin: 'https://pos.nuatis.com',
      })
    )
    expect(res.status).not.toBe(403)
  })

  it('allows a POST with no Origin header (server-side call)', async () => {
    const res = await proxy(req('/api/pos/tickets/fire', { method: 'POST', cookie: live() }))
    expect(res.status).not.toBe(403)
  })

  it('does not CSRF-check a GET', async () => {
    const res = await proxy(
      req('/api/pos/menu/tree', { cookie: live(), origin: 'https://evil.example' })
    )
    expect(res.status).not.toBe(403)
  })

  it('checks CSRF before the session, so an attacker learns nothing from the status', async () => {
    // Cross-origin POST with no session must still be 403, not 401 — a
    // differing status would tell an attacker whether a register is signed in.
    const res = await proxy(
      req('/api/pos/tickets/fire', { method: 'POST', origin: 'https://evil.example' })
    )
    expect(res.status).toBe(403)
  })
})

describe('session route passthrough', () => {
  it('never intercepts /api/session — it is how you sign in', async () => {
    const res = await proxy(req('/api/session', { method: 'POST' }))
    expect(res.status).not.toBe(401)
    expect(res.headers.get('x-middleware-rewrite')).toBeNull()
  })

  it('still CSRF-protects the session route', async () => {
    const res = await proxy(req('/api/session', { method: 'POST', origin: 'https://evil.example' }))
    expect(res.status).toBe(403)
  })
})

describe('page routing', () => {
  it('redirects an unauthenticated page request to the sign-in screen', async () => {
    const res = await proxy(req('/'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/sign-in')
  })

  it('redirects an expired page request to the sign-in screen', async () => {
    const res = await proxy(req('/', { cookie: live({ expiresAt: 1 }) }))
    expect(res.headers.get('location')).toContain('/sign-in')
  })

  it('lets the sign-in screen itself through unauthenticated', async () => {
    const res = await proxy(req('/sign-in'))
    expect(res.headers.get('location')).toBeNull()
  })

  it('does not redirect an authenticated page request', async () => {
    const res = await proxy(req('/', { cookie: live() }))
    expect(res.headers.get('location')).toBeNull()
  })
})
