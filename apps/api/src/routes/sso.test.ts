import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { mintTestToken } from './__test-support__/jwt.js'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from './__test-support__/supabase-mock.js'

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'
process.env['REDIS_URL'] = 'redis://localhost:6379'
process.env['WEB_URL'] = 'https://app.example.com'
delete process.env['WORKOS_API_KEY']
delete process.env['WORKOS_CLIENT_ID']

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

const redisStore = new Map<string, string>()
const mockRedis = {
  set: jest.fn(async (key: string, value: string) => {
    redisStore.set(key, value)
    return 'OK'
  }),
  get: jest.fn(async (key: string) => redisStore.get(key) ?? null),
  del: jest.fn(async (key: string) => {
    redisStore.delete(key)
    return 1
  }),
}
jest.unstable_mockModule('../lib/redis.js', () => ({ default: mockRedis }))

const isWorkosConfigured = jest.fn(() => false)
const getSsoAuthorizationUrl = jest.fn(() => 'https://api.workos.com/sso/authorize?state=x')
const authenticateWithCode = jest.fn(async () => ({
  workosUserId: 'user_workos_1',
  organizationId: 'org_1',
  email: 'jane@acme.com',
  firstName: 'Jane',
  lastName: 'Doe',
}))
const createWorkosOrganization = jest.fn(async () => 'org_new_1')
const getWorkosPortalLink = jest.fn(async () => 'https://portal.workos.com/link/xyz')
jest.unstable_mockModule('../lib/workos.js', () => ({
  isWorkosConfigured,
  getSsoAuthorizationUrl,
  authenticateWithCode,
  createWorkosOrganization,
  getWorkosPortalLink,
}))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000sso0001'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET

async function makeToken(role = 'owner'): Promise<string> {
  return mintTestToken({ sub: 'user-1', tenantId: TENANT_ID, role }, { secret: SECRET })
}

const [
  { default: express },
  { default: request },
  { default: ssoAuthRouter },
  { default: ssoAdminRouter },
] = await Promise.all([
  import('express'),
  import('supertest'),
  import('./sso-auth.js'),
  import('./sso-admin.js'),
])

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/auth/sso', ssoAuthRouter)
  app.use('/api/sso', ssoAdminRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = [
    {
      id: TENANT_ID,
      name: 'Acme Co',
      sso_enabled: false,
      sso_domain: null,
      workos_organization_id: null,
      modules: { sso: true },
      vertical: 'sales_crm',
      subscription_status: 'active',
    },
  ]
  store.tables['users'] = []
  store.tables['sso_connections'] = []
  redisStore.clear()
  isWorkosConfigured.mockClear()
  isWorkosConfigured.mockReturnValue(false)
  getSsoAuthorizationUrl.mockClear()
  authenticateWithCode.mockClear()
  createWorkosOrganization.mockClear()
  getWorkosPortalLink.mockClear()
})

describe('GET /api/auth/sso/check', () => {
  it('reports not enabled for an unknown domain', async () => {
    const res = await request(makeApp()).get('/api/auth/sso/check?email=jane@nowhere.com')
    expect(res.status).toBe(200)
    expect(res.body.ssoEnabled).toBe(false)
  })

  it('reports enabled + tenantId for a matching, enabled domain', async () => {
    store.tables['tenants'] = [
      { ...(store.tables['tenants'] as Row[])[0], sso_enabled: true, sso_domain: 'acme.com' },
    ]
    const res = await request(makeApp()).get('/api/auth/sso/check?email=jane@ACME.com')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ssoEnabled: true, tenantId: TENANT_ID })
  })

  it('reports not enabled with no email', async () => {
    const res = await request(makeApp()).get('/api/auth/sso/check')
    expect(res.status).toBe(200)
    expect(res.body.ssoEnabled).toBe(false)
  })
})

describe('GET /api/auth/sso/authorize', () => {
  it('503s when WorkOS is not configured', async () => {
    const res = await request(makeApp()).get(`/api/auth/sso/authorize?tenantId=${TENANT_ID}`)
    expect(res.status).toBe(503)
  })

  it('400s when SSO is not enabled for the tenant', async () => {
    isWorkosConfigured.mockReturnValue(true)
    const res = await request(makeApp()).get(`/api/auth/sso/authorize?tenantId=${TENANT_ID}`)
    expect(res.status).toBe(400)
  })

  it('redirects to the WorkOS authorization url when enabled', async () => {
    isWorkosConfigured.mockReturnValue(true)
    store.tables['tenants'] = [
      {
        ...(store.tables['tenants'] as Row[])[0],
        sso_enabled: true,
        workos_organization_id: 'org_1',
      },
    ]
    const res = await request(makeApp()).get(`/api/auth/sso/authorize?tenantId=${TENANT_ID}`)
    expect(res.status).toBe(302)
    expect(res.headers['location']).toContain('workos.com')
    expect(getSsoAuthorizationUrl).toHaveBeenCalledWith('org_1', expect.any(String))
  })
})

describe('GET /api/auth/sso/callback', () => {
  it('redirects with sso_expired when the nonce is unknown', async () => {
    const res = await request(makeApp()).get('/api/auth/sso/callback?code=c1&state=bogus')
    expect(res.status).toBe(302)
    expect(res.headers['location']).toContain('sso_expired')
  })

  it('JIT-provisions a new user and redirects with an exchange code', async () => {
    redisStore.set('oauth:sso:nonce1', TENANT_ID)
    const res = await request(makeApp()).get('/api/auth/sso/callback?code=c1&state=nonce1')
    expect(res.status).toBe(302)
    expect(res.headers['location']).toMatch(/ssoExchange=[a-f0-9]{64}/)

    const users = store.tables['users'] as Row[]
    expect(users).toHaveLength(1)
    expect(users[0]?.['authjs_user_id']).toBe('workos:user_workos_1')
    expect(users[0]?.['email']).toBe('jane@acme.com')
    expect(users[0]?.['tenant_id']).toBe(TENANT_ID)

    // Nonce is single-use.
    expect(redisStore.has('oauth:sso:nonce1')).toBe(false)
  })

  it('reuses an existing user on a repeat login instead of re-provisioning', async () => {
    store.tables['users'] = [
      {
        id: 'existing-user-1',
        tenant_id: TENANT_ID,
        authjs_user_id: 'workos:user_workos_1',
        email: 'jane@acme.com',
        role: 'admin',
        is_active: true,
      },
    ]
    redisStore.set('oauth:sso:nonce2', TENANT_ID)
    const res = await request(makeApp()).get('/api/auth/sso/callback?code=c1&state=nonce2')
    expect(res.status).toBe(302)
    expect(store.tables['users']).toHaveLength(1)
  })

  it('redirects with sso_inactive for a deactivated user', async () => {
    store.tables['users'] = [
      {
        id: 'existing-user-1',
        tenant_id: TENANT_ID,
        authjs_user_id: 'workos:user_workos_1',
        email: 'jane@acme.com',
        role: 'admin',
        is_active: false,
      },
    ]
    redisStore.set('oauth:sso:nonce3', TENANT_ID)
    const res = await request(makeApp()).get('/api/auth/sso/callback?code=c1&state=nonce3')
    expect(res.status).toBe(302)
    expect(res.headers['location']).toContain('sso_inactive')
  })
})

describe('POST /api/auth/sso/redeem', () => {
  it('400s for an unknown exchange code', async () => {
    const res = await request(makeApp()).post('/api/auth/sso/redeem').send({ exchangeCode: 'nope' })
    expect(res.status).toBe(400)
  })

  it('redeems a valid code once and returns the stored claims', async () => {
    redisStore.set('sso-exchange:abc123', JSON.stringify({ appUserId: 'u1', tenantId: TENANT_ID }))
    const res = await request(makeApp())
      .post('/api/auth/sso/redeem')
      .send({ exchangeCode: 'abc123' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ appUserId: 'u1', tenantId: TENANT_ID })

    // Single-use — a second redeem fails.
    const res2 = await request(makeApp())
      .post('/api/auth/sso/redeem')
      .send({ exchangeCode: 'abc123' })
    expect(res2.status).toBe(400)
  })
})

describe('GET /api/sso/connection', () => {
  it('returns current status', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/sso/connection')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.enabled).toBe(false)
    expect(res.body.hasOrganization).toBe(false)
  })
})

describe('POST /api/sso/connection', () => {
  it('503s when WorkOS is not configured', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/sso/connection')
      .set('Authorization', `Bearer ${token}`)
      .send({ domain: 'acme.com' })
    expect(res.status).toBe(503)
  })

  it('400s on an invalid domain', async () => {
    isWorkosConfigured.mockReturnValue(true)
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/sso/connection')
      .set('Authorization', `Bearer ${token}`)
      .send({ domain: 'not a domain' })
    expect(res.status).toBe(400)
  })

  it('403s for a staff role', async () => {
    isWorkosConfigured.mockReturnValue(true)
    const token = await makeToken('staff')
    const res = await request(makeApp())
      .post('/api/sso/connection')
      .set('Authorization', `Bearer ${token}`)
      .send({ domain: 'acme.com' })
    expect(res.status).toBe(403)
  })

  it('creates a WorkOS organization and saves the domain', async () => {
    isWorkosConfigured.mockReturnValue(true)
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/sso/connection')
      .set('Authorization', `Bearer ${token}`)
      .send({ domain: 'acme.com' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ organizationId: 'org_new_1', domain: 'acme.com' })
    expect(createWorkosOrganization).toHaveBeenCalledWith('Acme Co')

    const tenant = (store.tables['tenants'] as Row[])[0]
    expect(tenant?.['sso_domain']).toBe('acme.com')
    expect(tenant?.['workos_organization_id']).toBe('org_new_1')
  })
})

describe('GET /api/sso/connection/portal-link', () => {
  it('400s when no organization has been created yet', async () => {
    isWorkosConfigured.mockReturnValue(true)
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/sso/connection/portal-link')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(400)
  })

  it('returns the generated portal link', async () => {
    isWorkosConfigured.mockReturnValue(true)
    store.tables['tenants'] = [
      { ...(store.tables['tenants'] as Row[])[0], workos_organization_id: 'org_1' },
    ]
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/sso/connection/portal-link')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.url).toBe('https://portal.workos.com/link/xyz')
  })
})

describe('PATCH /api/sso/connection', () => {
  it('400s enabling before setup is complete', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .patch('/api/sso/connection')
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: true })
    expect(res.status).toBe(400)
  })

  it('enables SSO once a domain + organization exist', async () => {
    store.tables['tenants'] = [
      {
        ...(store.tables['tenants'] as Row[])[0],
        sso_domain: 'acme.com',
        workos_organization_id: 'org_1',
      },
    ]
    const token = await makeToken()
    const res = await request(makeApp())
      .patch('/api/sso/connection')
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: true })
    expect(res.status).toBe(200)
    expect(res.body.enabled).toBe(true)
    expect((store.tables['tenants'] as Row[])[0]?.['sso_enabled']).toBe(true)
  })
})
