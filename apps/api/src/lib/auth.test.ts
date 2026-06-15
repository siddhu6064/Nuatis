import { describe, it, expect, jest } from '@jest/globals'
import { config } from 'dotenv'
import { resolve } from 'path'
import { SignJWT } from 'jose'
import { mintTestToken } from '../routes/__test-support__/jwt.js'
import type { AuthenticatedRequest } from './auth.js'

config({ path: resolve(process.cwd(), '.env') })

// ── Supabase mock ─────────────────────────────────────────────────────────────
// Prevents resolveAppUserId from making a real DB call (which would hang in CI
// where there is no live Supabase connection). Auth tests assert tenantId/role,
// not appUserId, so null is the correct no-op return here.
jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => {
    const chain: Record<string, (...args: unknown[]) => unknown> = {}
    chain['from'] = () => chain
    chain['select'] = () => chain
    chain['eq'] = () => chain
    chain['limit'] = () => chain
    chain['maybeSingle'] = () => Promise.resolve({ data: null, error: null })
    chain['single'] = () => Promise.resolve({ data: null, error: null })
    return chain
  },
}))

// Dynamic imports must come after jest.unstable_mockModule calls
const [{ default: express }, { default: request }, { requireAuth }] = await Promise.all([
  import('express'),
  import('supertest'),
  import('./auth.js'),
])

// ── Test app with a protected route ──────────────────────────
const testApp = express()
testApp.use(express.json())

testApp.get('/protected', requireAuth, (req, res) => {
  const authed = req as AuthenticatedRequest
  res.json({
    tenantId: authed.tenantId,
    role: authed.role,
    vertical: authed.vertical,
    provider: authed.authProvider,
  })
})

// ── Helpers ───────────────────────────────────────────────────
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'

async function makeToken(
  payload: Record<string, unknown>,
  expiresIn: string = '1h'
): Promise<string> {
  return mintTestToken(payload, { secret: SECRET, expiresIn })
}

const TENANT_A = 'aaaaaaaa-0000-0000-0000-000000000001'
const TENANT_B = 'bbbbbbbb-0000-0000-0000-000000000002'

// ── Test suites ───────────────────────────────────────────────
describe('Auth middleware — Auth.js path', () => {
  it('valid JWT: returns 200 and exposes tenantId + role', async () => {
    const token = await makeToken({
      sub: 'user-001',
      tenantId: TENANT_A,
      role: 'owner',
      vertical: 'dental',
    })

    const res = await request(testApp).get('/protected').set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.tenantId).toBe(TENANT_A)
    expect(res.body.role).toBe('owner')
    expect(res.body.vertical).toBe('dental')
    expect(res.body.provider).toBe('authjs')
  })

  it('missing Authorization header: returns 401', async () => {
    const res = await request(testApp).get('/protected')
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('Missing authorization header')
  })

  it('malformed header (no Bearer prefix): returns 401', async () => {
    const token = await makeToken({ sub: 'user-001', tenantId: TENANT_A })
    const res = await request(testApp).get('/protected').set('Authorization', token) // missing "Bearer "
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('Missing authorization header')
  })

  it('expired JWT: returns 401 with "Token expired"', async () => {
    const token = await makeToken(
      { sub: 'user-001', tenantId: TENANT_A, role: 'owner' },
      '-1s' // already expired
    )

    const res = await request(testApp).get('/protected').set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(401)
    expect(res.body.error).toBe('Token expired')
  })

  it('invalid JWT (tampered signature): returns 401', async () => {
    const token = await makeToken({ sub: 'user-001', tenantId: TENANT_A })
    const tampered = token.slice(0, -6) + 'XXXXXX' // corrupt last 6 chars

    const res = await request(testApp).get('/protected').set('Authorization', `Bearer ${tampered}`)

    expect(res.status).toBe(401)
    expect(res.body.error).toMatch(/invalid|failed/i)
  })

  it('JWT missing tenantId: returns 401 with context error', async () => {
    const token = await makeToken({
      sub: 'user-001',
      role: 'owner',
      // no tenantId
    })

    const res = await request(testApp).get('/protected').set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(401)
    expect(res.body.error).toBe('Token missing tenant context')
  })

  it('completely invalid string: returns 401', async () => {
    const res = await request(testApp).get('/protected').set('Authorization', 'Bearer not.a.jwt')

    expect(res.status).toBe(401)
  })
})

describe('Auth middleware — iss/aud binding', () => {
  const BASE = { sub: 'user-001', tenantId: TENANT_A, role: 'owner', vertical: 'dental' }

  it('accepts a web token (iss nuatis-web, aud nuatis-api)', async () => {
    const token = await mintTestToken(BASE, { secret: SECRET, issuer: 'nuatis-web' })
    const res = await request(testApp).get('/protected').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.tenantId).toBe(TENANT_A)
  })

  it('accepts a mobile token (iss nuatis-mobile, aud nuatis-api)', async () => {
    const token = await mintTestToken(BASE, { secret: SECRET, issuer: 'nuatis-mobile' })
    const res = await request(testApp).get('/protected').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.tenantId).toBe(TENANT_A)
  })

  it('rejects a token missing iss', async () => {
    const token = await mintTestToken(BASE, { secret: SECRET, issuer: null })
    const res = await request(testApp).get('/protected').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('Invalid token')
  })

  it('rejects a token missing aud', async () => {
    const token = await mintTestToken(BASE, { secret: SECRET, audience: null })
    const res = await request(testApp).get('/protected').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('Invalid token')
  })

  it('rejects a token with an unknown iss', async () => {
    const token = await mintTestToken(BASE, { secret: SECRET, issuer: 'evil' })
    const res = await request(testApp).get('/protected').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('Invalid token')
  })

  it('rejects a token with the wrong aud', async () => {
    const token = await mintTestToken(BASE, { secret: SECRET, audience: 'some-other-api' })
    const res = await request(testApp).get('/protected').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('Invalid token')
  })
})

describe('Auth middleware — cross-tenant isolation', () => {
  it('Tenant A token cannot be used to read Tenant B data', async () => {
    // Two separate tokens for two separate tenants
    const tokenA = await makeToken({ sub: 'user-A', tenantId: TENANT_A, role: 'owner' })
    const tokenB = await makeToken({ sub: 'user-B', tenantId: TENANT_B, role: 'owner' })

    const resA = await request(testApp).get('/protected').set('Authorization', `Bearer ${tokenA}`)

    const resB = await request(testApp).get('/protected').set('Authorization', `Bearer ${tokenB}`)

    // Both succeed but with completely different tenant contexts
    expect(resA.status).toBe(200)
    expect(resB.status).toBe(200)
    expect(resA.body.tenantId).toBe(TENANT_A)
    expect(resB.body.tenantId).toBe(TENANT_B)

    // Cross-check: Tenant A's token does NOT expose Tenant B's ID
    expect(resA.body.tenantId).not.toBe(TENANT_B)
    expect(resB.body.tenantId).not.toBe(TENANT_A)
  })

  it('swapped token: Tenant A token rejected if signed with wrong secret', async () => {
    // Sign with a DIFFERENT secret (simulates a token from another system)
    const wrongSecret = new TextEncoder().encode('wrong-secret-completely-different-32ch')
    const forgedToken = await new SignJWT({ sub: 'attacker', tenantId: TENANT_B, role: 'owner' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(wrongSecret)

    const res = await request(testApp)
      .get('/protected')
      .set('Authorization', `Bearer ${forgedToken}`)

    expect(res.status).toBe(401)
    expect(res.body.error).toMatch(/invalid|failed/i)
  })
})
