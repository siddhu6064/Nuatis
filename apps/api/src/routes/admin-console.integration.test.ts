import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { mintTestToken } from './__test-support__/jwt.js'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from './__test-support__/supabase-mock.js'

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

const PLATFORM_TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000plat001'
const OTHER_TENANT_ID = 'bbbbbbbb-0000-0000-0000-00000plat002'
const PLATFORM_USER_ID = 'platform-user-1'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'
process.env['PLATFORM_TENANT_ID'] = PLATFORM_TENANT_ID
process.env['REDIS_URL'] = 'redis://localhost:6379'

async function makePlatformToken(role = 'owner'): Promise<string> {
  return mintTestToken(
    { sub: 'nuatis-1', appUserId: PLATFORM_USER_ID, tenantId: PLATFORM_TENANT_ID, role },
    { secret: SECRET }
  )
}
async function makeOtherToken(): Promise<string> {
  return mintTestToken(
    { sub: 'user-1', tenantId: OTHER_TENANT_ID, role: 'owner' },
    { secret: SECRET }
  )
}

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: adminConsoleRouter } = await import('./admin-console.js')

function makeApp() {
  const app = express()
  app.use('/api/admin-console', express.json(), adminConsoleRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = [
    {
      id: 'tenant-a',
      name: 'Acme Dental',
      billing_email: 'billing@acme.test',
      subscription_status: 'active',
      subscription_plan: 'pro',
      created_at: '2026-01-01T00:00:00Z',
    },
    {
      id: 'tenant-b',
      name: 'Beta Salon',
      billing_email: 'ops@beta.test',
      subscription_status: 'trialing',
      subscription_plan: 'core',
      created_at: '2026-02-01T00:00:00Z',
    },
  ]
  store.tables['users'] = [
    {
      id: PLATFORM_USER_ID,
      tenant_id: PLATFORM_TENANT_ID,
      email: 'support@nuatis.com',
      role: 'owner',
    },
  ]
  store.tables['impersonation_sessions'] = []
  redisStore.clear()
})

describe('Access control', () => {
  it('403s a non-platform tenant', async () => {
    const token = await makeOtherToken()
    const res = await request(makeApp())
      .get('/api/admin-console/tenants')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
  })

  it('403s a platform-tenant non-owner role', async () => {
    const token = await makePlatformToken('staff')
    const res = await request(makeApp())
      .get('/api/admin-console/tenants')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
  })

  it('allows the platform tenant owner', async () => {
    const token = await makePlatformToken()
    const res = await request(makeApp())
      .get('/api/admin-console/access-check')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })
})

describe('GET /api/admin-console/tenants', () => {
  it('lists all tenants across the whole platform', async () => {
    const token = await makePlatformToken()
    const res = await request(makeApp())
      .get('/api/admin-console/tenants')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(2)
  })

  it('filters by search query', async () => {
    const token = await makePlatformToken()
    const res = await request(makeApp())
      .get('/api/admin-console/tenants?q=Acme')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].name).toBe('Acme Dental')
  })
})

describe('GET /api/admin-console/tenants/:id', () => {
  it('never exposes the raw stripe_customer_id', async () => {
    store.tables['tenants'] = [
      { id: 'tenant-a', name: 'Acme', stripe_customer_id: 'cus_secret123' },
    ]
    const token = await makePlatformToken()
    const res = await request(makeApp())
      .get('/api/admin-console/tenants/tenant-a')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.stripe_customer_id).toBeUndefined()
    expect(res.body.has_stripe_customer).toBe(true)
  })
})

describe('GET /api/admin-console/tenants/:id/activity', () => {
  it('returns counts and recent activity for the tenant', async () => {
    store.tables['tenants'] = [{ id: 'tenant-a', name: 'Acme' }]
    store.tables['contacts'] = [
      { id: 'c1', tenant_id: 'tenant-a' },
      { id: 'c2', tenant_id: 'tenant-a' },
      { id: 'c3', tenant_id: 'other-tenant' },
    ]
    store.tables['appointments'] = [{ id: 'a1', tenant_id: 'tenant-a' }]
    store.tables['deals'] = []
    store.tables['voice_sessions'] = [{ id: 'v1', tenant_id: 'tenant-a' }]
    store.tables['activity_log'] = [
      {
        id: 'act1',
        tenant_id: 'tenant-a',
        type: 'note',
        body: 'Called about follow-up',
        actor_type: 'user',
        created_at: '2026-08-01T00:00:00Z',
      },
      {
        id: 'act2',
        tenant_id: 'other-tenant',
        type: 'note',
        body: 'Should not appear',
        actor_type: 'user',
        created_at: '2026-08-02T00:00:00Z',
      },
    ]

    const token = await makePlatformToken()
    const res = await request(makeApp())
      .get('/api/admin-console/tenants/tenant-a/activity')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.counts).toEqual({ contacts: 2, appointments: 1, deals: 0, calls: 1 })
    expect(res.body.recent_activity).toHaveLength(1)
    expect(res.body.recent_activity[0].id).toBe('act1')
  })

  it('404s for an unknown tenant id', async () => {
    const token = await makePlatformToken()
    const res = await request(makeApp())
      .get('/api/admin-console/tenants/does-not-exist/activity')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })

  it('403s a non-platform tenant', async () => {
    const token = await makeOtherToken()
    const res = await request(makeApp())
      .get('/api/admin-console/tenants/tenant-a/activity')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(403)
  })
})

describe('GET /api/admin-console/summary', () => {
  it('aggregates by status and plan', async () => {
    const token = await makePlatformToken()
    const res = await request(makeApp())
      .get('/api/admin-console/summary')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.total_tenants).toBe(2)
    expect(res.body.by_status.active).toBe(1)
    expect(res.body.by_status.trialing).toBe(1)
  })
})

describe('GET /api/admin-console/product-health', () => {
  it('reports adoption per feature, scoped to tenants with the module enabled', async () => {
    store.tables['tenants'] = [
      // pro plan → cpq NOT included (scale-only), scheduling/orders included
      {
        id: 'tenant-a',
        name: 'Acme',
        subscription_plan: 'pro',
        product: 'suite',
        modules: null,
      },
      // explicit override disables scheduling even though pro would default it on
      {
        id: 'tenant-b',
        name: 'Beta',
        subscription_plan: 'pro',
        product: 'suite',
        modules: { scheduling: false },
      },
    ]
    const now = new Date().toISOString()
    store.tables['appointments'] = [{ id: 'a1', tenant_id: 'tenant-a', created_at: now }]
    store.tables['orders'] = []
    store.tables['deals'] = []
    store.tables['custom_automations'] = []
    store.tables['campaign_sends'] = []
    store.tables['quotes'] = []
    store.tables['expenses'] = []
    store.tables['time_entries'] = []

    const token = await makePlatformToken()
    const res = await request(makeApp())
      .get('/api/admin-console/product-health')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const scheduling = res.body.features.find(
      (f: { moduleId: string }) => f.moduleId === 'scheduling'
    )
    expect(scheduling.tenantsEnabled).toBe(1) // only tenant-a — tenant-b explicitly disabled it
    expect(scheduling.tenantsActive).toBe(1)
    expect(scheduling.adoptionPct).toBe(100)
  })

  it('403s a non-platform tenant', async () => {
    const token = await makeOtherToken()
    const res = await request(makeApp())
      .get('/api/admin-console/product-health')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
  })
})

describe('GET /api/admin-console/trial-funnel', () => {
  it('buckets tenants by trial/conversion outcome', async () => {
    const past = new Date(Date.now() - 86400000).toISOString()
    const future = new Date(Date.now() + 86400000).toISOString()
    store.tables['tenants'] = [
      { id: 't1', subscription_status: 'trialing', trial_ends_at: future },
      { id: 't2', subscription_status: 'trialing', trial_ends_at: past },
      { id: 't3', subscription_status: 'active', trial_ends_at: past },
      { id: 't4', subscription_status: 'canceled', trial_ends_at: past },
      { id: 't5', subscription_status: 'cancelled', trial_ends_at: past }, // legacy spelling
      { id: 't6', subscription_status: 'past_due', trial_ends_at: past },
    ]

    const token = await makePlatformToken()
    const res = await request(makeApp())
      .get('/api/admin-console/trial-funnel')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.still_trialing).toBe(1)
    expect(res.body.expired_no_convert).toBe(1)
    expect(res.body.converted).toBe(1)
    expect(res.body.canceled).toBe(2) // both spellings bucket together
    expect(res.body.payment_issue).toBe(1)
    // conversion_rate = converted / (converted+expired+canceled+payment_issue) = 1/5 = 20%
    expect(res.body.conversion_rate).toBe(20)
  })

  it('403s a non-platform tenant', async () => {
    const token = await makeOtherToken()
    const res = await request(makeApp())
      .get('/api/admin-console/trial-funnel')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
  })
})

describe('POST /api/admin-console/tenants/:id/impersonate', () => {
  beforeEach(() => {
    ;(
      store.tables['users'] as {
        id: string
        tenant_id: string
        email: string
        role: string
        is_active: boolean
      }[]
    ).push({
      id: 'target-owner-1',
      tenant_id: 'tenant-a',
      email: 'owner@acme.test',
      role: 'owner',
      is_active: true,
    })
  })

  it('400s without a reason', async () => {
    const token = await makePlatformToken()
    const res = await request(makeApp())
      .post('/api/admin-console/tenants/tenant-a/impersonate')
      .set('Authorization', `Bearer ${token}`)
      .send({})
    expect(res.status).toBe(400)
  })

  it('starts a session and returns an exchange code', async () => {
    const token = await makePlatformToken()
    const res = await request(makeApp())
      .post('/api/admin-console/tenants/tenant-a/impersonate')
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'ticket #123 — booking page broken' })

    expect(res.status).toBe(200)
    expect(typeof res.body.exchangeCode).toBe('string')

    const sessions = store.tables['impersonation_sessions'] as Array<Record<string, unknown>>
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.['platform_user_id']).toBe(PLATFORM_USER_ID)
    expect(sessions[0]?.['platform_user_email']).toBe('support@nuatis.com')
    expect(sessions[0]?.['target_tenant_id']).toBe('tenant-a')
    expect(sessions[0]?.['reason']).toBe('ticket #123 — booking page broken')
  })

  it('errors when the target tenant has no active owner to act as', async () => {
    store.tables['users'] = [
      {
        id: PLATFORM_USER_ID,
        tenant_id: PLATFORM_TENANT_ID,
        email: 'support@nuatis.com',
        role: 'owner',
      },
    ]
    const token = await makePlatformToken()
    const res = await request(makeApp())
      .post('/api/admin-console/tenants/tenant-a/impersonate')
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'test' })
    expect(res.status).toBe(400)
  })

  it('403s a non-platform tenant', async () => {
    const token = await makeOtherToken()
    const res = await request(makeApp())
      .post('/api/admin-console/tenants/tenant-a/impersonate')
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'test' })
    expect(res.status).toBe(403)
  })
})

describe('GET /api/admin-console/impersonate/sessions', () => {
  it('lists sessions newest first with the tenant name resolved', async () => {
    store.tables['impersonation_sessions'] = [
      {
        id: 'sess-1',
        platform_user_email: 'support@nuatis.com',
        target_tenant_id: 'tenant-a',
        reason: 'debugging',
        started_at: '2026-08-01T00:00:00Z',
        expires_at: '2026-08-01T00:30:00Z',
        ended_at: null,
      },
    ]
    const token = await makePlatformToken()
    const res = await request(makeApp())
      .get('/api/admin-console/impersonate/sessions')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.sessions).toHaveLength(1)
    expect(res.body.sessions[0].tenant_name).toBe('Acme Dental')
    expect(res.body.sessions[0].platform_user_email).toBe('support@nuatis.com')
  })
})

describe('POST /api/admin-console/impersonate/:sessionId/end', () => {
  it('marks a session ended', async () => {
    store.tables['impersonation_sessions'] = [
      {
        id: 'sess-1',
        platform_user_id: PLATFORM_USER_ID,
        target_tenant_id: 'tenant-a',
        ended_at: null,
      },
    ]
    const token = await makePlatformToken()
    const res = await request(makeApp())
      .post('/api/admin-console/impersonate/sess-1/end')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.ended).toBe(true)
    expect(
      (store.tables['impersonation_sessions'] as Array<Record<string, unknown>>)[0]?.['ended_at']
    ).not.toBeNull()
  })

  it('is a no-op for a session already ended', async () => {
    store.tables['impersonation_sessions'] = [
      {
        id: 'sess-1',
        platform_user_id: PLATFORM_USER_ID,
        target_tenant_id: 'tenant-a',
        ended_at: '2026-08-01T00:00:00Z',
      },
    ]
    const token = await makePlatformToken()
    const res = await request(makeApp())
      .post('/api/admin-console/impersonate/sess-1/end')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.ended).toBe(false)
  })
})
