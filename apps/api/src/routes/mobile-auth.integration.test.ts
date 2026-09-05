import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { mintTestToken } from './__test-support__/jwt.js'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from './__test-support__/supabase-mock.js'

let store: MockStore = createStore()
// email -> password, backing the anon-key signInWithPassword call mobile-auth
// makes on a second createClient() — the shared mock has no auth password
// flow, so it's composed on top here rather than edited into the shared file.
const validPasswords = new Map<string, string>()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => {
    const base = createMockSupabase(store) as {
      auth: Record<string, unknown>
      [k: string]: unknown
    }
    base.auth['signInWithPassword'] = async ({
      email,
      password,
    }: {
      email: string
      password: string
    }) => {
      if (validPasswords.get(email) === password) {
        return { data: { session: { access_token: 'mock-session-token' } }, error: null }
      }
      return { data: { session: null }, error: { message: 'Invalid login credentials' } }
    }
    return base
  },
}))

const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'
process.env['SUPABASE_ANON_KEY'] = 'mock-anon-key'

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { requireAuth } = await import('../lib/auth.js')
const { default: mobileAuthRouter } = await import('./mobile-auth.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/auth/mobile', mobileAuthRouter)
  app.get('/protected', requireAuth, (req, res) => {
    const authed = req as import('../lib/auth.js').AuthenticatedRequest
    res.json({
      tenantId: authed.tenantId,
      userId: authed.userId,
      appUserId: authed.appUserId,
      role: authed.role,
      vertical: authed.vertical,
    })
  })
  app.get('/api/staff-portal/protected', requireAuth, (_req, res) => {
    res.json({ ok: true })
  })
  return app
}

const TENANT_A = 'aaaaaaaa-0000-0000-0000-000000000001'

beforeEach(() => {
  store = createStore()
  validPasswords.clear()
  store.tables['tenants'] = [{ id: TENANT_A, vertical: 'dental' }]
  store.tables['users'] = [
    {
      id: 'user-owner-1',
      authjs_user_id: 'authjs-owner-1',
      tenant_id: TENANT_A,
      email: 'owner@acme.test',
      full_name: 'Owner Acme',
      role: 'owner',
      is_active: true,
    },
    {
      id: 'user-staff-1',
      authjs_user_id: 'authjs-staff-1',
      tenant_id: TENANT_A,
      email: 'staff@acme.test',
      full_name: 'Staff Acme',
      role: 'staff',
      is_active: true,
    },
    {
      id: 'user-nullauthjs-1',
      authjs_user_id: null,
      tenant_id: TENANT_A,
      email: 'legacy@acme.test',
      full_name: 'Legacy Acme',
      role: 'owner',
      is_active: true,
    },
  ]
  validPasswords.set('owner@acme.test', 'correct-password')
  validPasswords.set('staff@acme.test', 'correct-password')
  validPasswords.set('legacy@acme.test', 'correct-password')
})

describe('POST /api/auth/mobile/login', () => {
  it('non-staff login: token carries appUserId = users.id, vertical, and NO portalScope claim', async () => {
    const app = makeApp()
    const loginRes = await request(app)
      .post('/api/auth/mobile/login')
      .send({ email: 'owner@acme.test', password: 'correct-password' })
    expect(loginRes.status).toBe(200)

    const protectedRes = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${loginRes.body.token}`)
    expect(protectedRes.status).toBe(200)
    expect(protectedRes.body.appUserId).toBe('user-owner-1')
    expect(protectedRes.body.userId).toBe('authjs-owner-1') // sub = authjs_user_id, not users.id
    expect(protectedRes.body.vertical).toBe('dental')
  })

  it('sub matches authjs_user_id, not users.id', async () => {
    const app = makeApp()
    const loginRes = await request(app)
      .post('/api/auth/mobile/login')
      .send({ email: 'owner@acme.test', password: 'correct-password' })
    const [, payloadB64] = loginRes.body.token.split('.')
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString())
    expect(payload.sub).toBe('authjs-owner-1')
    expect(payload.appUserId).toBe('user-owner-1')
    expect(payload.portalScope).toBeUndefined()
  })

  it('staff-role login receives a token carrying portalScope: staff', async () => {
    const app = makeApp()
    const loginRes = await request(app)
      .post('/api/auth/mobile/login')
      .send({ email: 'staff@acme.test', password: 'correct-password' })
    const [, payloadB64] = loginRes.body.token.split('.')
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString())
    expect(payload.portalScope).toBe('staff')
  })

  it('that staff token is 403d outside /api/staff-portal/*', async () => {
    const app = makeApp()
    const loginRes = await request(app)
      .post('/api/auth/mobile/login')
      .send({ email: 'staff@acme.test', password: 'correct-password' })
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${loginRes.body.token}`)
    expect(res.status).toBe(403)
  })

  it('that staff token IS allowed into /api/staff-portal/*', async () => {
    const app = makeApp()
    const loginRes = await request(app)
      .post('/api/auth/mobile/login')
      .send({ email: 'staff@acme.test', password: 'correct-password' })
    const res = await request(app)
      .get('/api/staff-portal/protected')
      .set('Authorization', `Bearer ${loginRes.body.token}`)
    expect(res.status).toBe(200)
  })

  it('a row with null authjs_user_id is rejected explicitly, not minted a broken token', async () => {
    const app = makeApp()
    const res = await request(app)
      .post('/api/auth/mobile/login')
      .send({ email: 'legacy@acme.test', password: 'correct-password' })
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Account not fully provisioned for mobile login')
  })

  it('null authjs_user_id + WRONG password: generic 401, not the 500 (no enumeration path opened)', async () => {
    const app = makeApp()
    const res = await request(app)
      .post('/api/auth/mobile/login')
      .send({ email: 'legacy@acme.test', password: 'wrong-password' })
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('Invalid credentials')
  })

  it('wrong password: generic 401, same shape as unknown email (no enumeration)', async () => {
    const app = makeApp()
    const unknownRes = await request(app)
      .post('/api/auth/mobile/login')
      .send({ email: 'nobody@acme.test', password: 'x' })
    const wrongPassRes = await request(app)
      .post('/api/auth/mobile/login')
      .send({ email: 'owner@acme.test', password: 'wrong' })
    expect(unknownRes.status).toBe(401)
    expect(wrongPassRes.status).toBe(401)
    expect(unknownRes.body).toEqual(wrongPassRes.body)
  })

  it('an old-format token (sub = users.id) still verifies and resolves appUserId to null', async () => {
    // Simulates a pre-fix 7-day token still in the wild post-deploy: sub carries
    // users.id (wrong identity space), no appUserId claim. It must still pass
    // requireAuth (alg/iss/aud/expiry only) and degrade to appUserId: null,
    // exactly as it does today — no crash, no regression, no silent "fix".
    const app = makeApp()
    const oldToken = await mintTestToken(
      { sub: 'user-owner-1', tenantId: TENANT_A, role: 'owner' },
      { secret: SECRET, issuer: 'nuatis-mobile' }
    )
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${oldToken}`)
    expect(res.status).toBe(200)
    expect(res.body.appUserId).toBeNull()
  })
})
