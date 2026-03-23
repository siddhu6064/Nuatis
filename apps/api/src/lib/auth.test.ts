import { config } from 'dotenv'
import { resolve } from 'path'
import request from 'supertest'
import express from 'express'
import { SignJWT } from 'jose'
import { requireAuth } from './auth.js'
import type { AuthenticatedRequest } from './auth.js'

config({ path: resolve(process.cwd(), '.env') })

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
  const secretBytes = new TextEncoder().encode(SECRET)
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secretBytes)
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
