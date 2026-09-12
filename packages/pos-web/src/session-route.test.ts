import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { createSessionRoute } from './session-route.js'
import { POS_COOKIE, readPosSession } from './session.js'

const { POST, DELETE } = createSessionRoute({ apiBackendUrl: 'http://api.test' })

// Typed loosely on purpose: these tests only care about `ok` and `json()`,
// and building a full Response for each case would bury what is asserted.
const fetchMock = jest.fn<(url: string, init: RequestInit) => Promise<unknown>>()
global.fetch = fetchMock as unknown as typeof fetch

function post(body: unknown): Request {
  return new Request('http://localhost:3002/api/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function okUpstream(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    json: async () => ({
      token: 'secret.jwt.value',
      staff: { id: 'staff-1', name: 'Dana' },
      locationId: 'loc-1',
      ...overrides,
    }),
  }
}

/** Pull the session cookie back out of a Set-Cookie header. */
function cookieFrom(res: Response): string | null {
  const raw = res.headers.get('set-cookie')
  if (!raw) return null
  const match = new RegExp(`${POS_COOKIE}=([^;]*)`).exec(raw)
  return match?.[1] ? decodeURIComponent(match[1]) : null
}

beforeEach(() => {
  fetchMock.mockReset()
})

describe('POST /api/session — validation', () => {
  it('400s when fields are missing', async () => {
    const res = await POST(post({ pin: '4821' }))
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('400s on a malformed body rather than throwing', async () => {
    const bad = new Request('http://localhost:3002/api/session', {
      method: 'POST',
      body: 'not json',
    })
    const res = await POST(bad)
    expect(res.status).toBe(400)
  })

  it('400s when the pin is an empty string', async () => {
    const res = await POST(post({ tenant_id: 't', location_id: 'l', pin: '' }))
    expect(res.status).toBe(400)
  })
})

describe('POST /api/session — upstream failures', () => {
  it('passes a rejected PIN through as a uniform 401', async () => {
    fetchMock.mockResolvedValue({ ok: false })
    const res = await POST(post({ tenant_id: 't', location_id: 'l', pin: '0000' }))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Invalid PIN' })
  })

  it('503s when the API is unreachable — an outage is not a bad PIN', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
    const res = await POST(post({ tenant_id: 't', location_id: 'l', pin: '4821' }))
    expect(res.status).toBe(503)
  })

  it('sets no cookie when sign-in fails', async () => {
    fetchMock.mockResolvedValue({ ok: false })
    const res = await POST(post({ tenant_id: 't', location_id: 'l', pin: '0000' }))
    expect(cookieFrom(res)).toBeNull()
  })
})

describe('POST /api/session — success', () => {
  it('returns the staff name and location', async () => {
    fetchMock.mockResolvedValue(okUpstream())
    const res = await POST(post({ tenant_id: 't', location_id: 'loc-1', pin: '4821' }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      staff: { id: 'staff-1', name: 'Dana' },
      locationId: 'loc-1',
    })
  })

  it('never returns the token in the response body', async () => {
    fetchMock.mockResolvedValue(okUpstream())
    const res = await POST(post({ tenant_id: 't', location_id: 'loc-1', pin: '4821' }))
    expect(await res.text()).not.toContain('secret.jwt.value')
  })

  it('sets the session cookie httpOnly', async () => {
    fetchMock.mockResolvedValue(okUpstream())
    const res = await POST(post({ tenant_id: 't', location_id: 'loc-1', pin: '4821' }))
    expect(res.headers.get('set-cookie') ?? '').toContain('HttpOnly')
  })

  it('stores a session the proxy can read back', async () => {
    fetchMock.mockResolvedValue(okUpstream())
    const res = await POST(post({ tenant_id: 'tenant-9', location_id: 'loc-1', pin: '4821' }))

    const session = readPosSession(cookieFrom(res) ?? undefined)
    expect(session).not.toBeNull()
    expect(session?.token).toBe('secret.jwt.value')
    expect(session?.tenantId).toBe('tenant-9')
    expect(session?.staffId).toBe('staff-1')
    expect(session?.expiresAt).toBeGreaterThan(Date.now())
  })

  it('trusts the API for the location, not the caller', async () => {
    // The API scopes the token to the location it verified; if the two ever
    // disagreed, storing the caller's value would point the register at a
    // location its own token does not cover.
    fetchMock.mockResolvedValue(okUpstream({ locationId: 'loc-verified' }))
    const res = await POST(post({ tenant_id: 't', location_id: 'loc-requested', pin: '4821' }))

    expect(readPosSession(cookieFrom(res) ?? undefined)?.locationId).toBe('loc-verified')
  })

  it('sends the PIN only to the API sign-in endpoint', async () => {
    fetchMock.mockResolvedValue(okUpstream())
    await POST(post({ tenant_id: 't', location_id: 'loc-1', pin: '4821' }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toContain('/api/pos/terminal/sign-in')
    expect(init.body).toContain('4821')
  })

  it('exchanges the PIN at the configured backend, not a hardcoded one', async () => {
    fetchMock.mockResolvedValue(okUpstream())
    await POST(post({ tenant_id: 't', location_id: 'loc-1', pin: '4821' }))

    const [url] = fetchMock.mock.calls[0]!
    expect(url).toBe('http://api.test/api/pos/terminal/sign-in')
  })
})

describe('DELETE /api/session', () => {
  it('clears the cookie', async () => {
    const res = await DELETE()
    const raw = res.headers.get('set-cookie') ?? ''
    expect(raw).toContain(POS_COOKIE)
    expect(raw).toMatch(/Max-Age=0/i)
  })
})
