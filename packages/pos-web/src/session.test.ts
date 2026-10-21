import { describe, it, expect } from '@jest/globals'
import { readPosSession, serializePosSession, isExpired, type PosSession } from './session.js'

function session(overrides: Partial<PosSession> = {}): PosSession {
  return {
    token: 'jwt.goes.here',
    tenantId: 'tenant-1',
    locationId: 'loc-1',
    staffId: 'staff-1',
    staffName: 'Dana',
    expiresAt: Date.now() + 60_000,
    ...overrides,
  }
}

describe('serialize / read round trip', () => {
  it('round-trips a session', () => {
    const s = session()
    expect(readPosSession(serializePosSession(s))).toEqual(s)
  })

  it('round-trips a session with no staff name', () => {
    const s = session({ staffName: null })
    expect(readPosSession(serializePosSession(s))).toEqual(s)
  })
})

describe('readPosSession', () => {
  it('returns null for undefined', () => {
    expect(readPosSession(undefined)).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(readPosSession('')).toBeNull()
  })

  it('returns null for a non-JSON cookie rather than throwing', () => {
    expect(readPosSession('not-json')).toBeNull()
  })

  it('returns null for JSON that is not an object', () => {
    expect(readPosSession('"a string"')).toBeNull()
    expect(readPosSession('null')).toBeNull()
    expect(readPosSession('[1,2,3]')).toBeNull()
  })

  it('returns null when a required field is missing', () => {
    expect(readPosSession(JSON.stringify({ token: 'x', tenantId: 'y' }))).toBeNull()
  })

  it('returns null when the token is not a string', () => {
    const bad = { ...session(), token: 12345 }
    expect(readPosSession(JSON.stringify(bad))).toBeNull()
  })

  it('returns null when expiresAt is not a number', () => {
    const bad = { ...session(), expiresAt: 'soon' }
    expect(readPosSession(JSON.stringify(bad))).toBeNull()
  })

  it('coerces a non-string staffName to null rather than rejecting the session', () => {
    const odd = { ...session(), staffName: 42 }
    expect(readPosSession(JSON.stringify(odd))?.staffName).toBeNull()
  })

  it('ignores unknown extra fields', () => {
    const extra = { ...session(), injected: 'whatever' }
    const read = readPosSession(JSON.stringify(extra))
    expect(read).not.toBeNull()
    expect((read as unknown as Record<string, unknown>)['injected']).toBeUndefined()
  })
})

describe('isExpired', () => {
  it('is false before expiry', () => {
    expect(isExpired(session({ expiresAt: 1_000 }), 999)).toBe(false)
  })

  it('is true at expiry — never hand a token to the API on its last ms', () => {
    expect(isExpired(session({ expiresAt: 1_000 }), 1_000)).toBe(true)
  })

  it('is true after expiry', () => {
    expect(isExpired(session({ expiresAt: 1_000 }), 1_001)).toBe(true)
  })
})
