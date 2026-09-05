import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { mintTestToken } from './__test-support__/jwt.js'
import { randomUUID } from 'node:crypto'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from './__test-support__/supabase-mock.js'

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000wh00001'
const USER_ID = 'user-wh-001'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(): Promise<string> {
  return mintTestToken(
    { sub: USER_ID, tenantId: TENANT_ID, role: 'owner', vertical: 'dental' },
    { secret: SECRET }
  )
}

const [{ default: express }, { default: request }, { default: webhooksRouter }] = await Promise.all(
  [import('express'), import('supertest'), import('./webhooks.js')]
)

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/webhooks', webhooksRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['webhook_subscriptions'] = []
  store.tables['webhook_deliveries'] = []
  store.tables['api_keys'] = []
})

describe('POST /api/webhooks', () => {
  it('creates subscription and returns 201 with secret', async () => {
    const token = await makeToken()

    const res = await request(makeApp())
      .post('/api/webhooks')
      .set('Authorization', `Bearer ${token}`)
      .send({
        url: 'https://example.com/hook',
        event_types: ['call.completed', 'appointment.booked'],
      })

    expect(res.status).toBe(201)
    expect(res.body.id).toBeDefined()
    expect(res.body.secret).toBeDefined()
    expect(res.body.url).toBe('https://example.com/hook')
  })

  it('returns 400 when event_type is not in allowed list', async () => {
    const token = await makeToken()

    const res = await request(makeApp())
      .post('/api/webhooks')
      .set('Authorization', `Bearer ${token}`)
      .send({
        url: 'https://example.com/hook',
        event_types: ['fake.event'],
      })

    expect(res.status).toBe(400)
  })
})

describe('GET /api/webhooks', () => {
  it('returns subscriptions array for tenant', async () => {
    ;(store.tables['webhook_subscriptions'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      url: 'https://example.com/seeded',
      event_types: ['contact.created'],
      is_active: true,
      created_at: new Date().toISOString(),
    })
    const token = await makeToken()

    const res = await request(makeApp())
      .get('/api/webhooks')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.subscriptions)).toBe(true)
    expect(res.body.subscriptions.length).toBeGreaterThanOrEqual(1)
  })
})

describe('DELETE /api/webhooks/:id', () => {
  it('deactivates subscription and returns deactivated:true', async () => {
    const subId = randomUUID()
    ;(store.tables['webhook_subscriptions'] as Row[]).push({
      id: subId,
      tenant_id: TENANT_ID,
      url: 'https://example.com/active',
      event_types: ['call.completed'],
      is_active: true,
    })
    const token = await makeToken()

    const res = await request(makeApp())
      .delete(`/api/webhooks/${subId}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.deactivated).toBe(true)

    const row = (store.tables['webhook_subscriptions'] as Row[]).find((r) => r['id'] === subId)
    expect(row?.['is_active']).toBe(false)
  })
})

describe('GET /api/webhooks/event-types', () => {
  it('returns the full event-type list, including previously-unsubscribable types', async () => {
    const token = await makeToken()

    const res = await request(makeApp())
      .get('/api/webhooks/event-types')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.event_types).toEqual(
      expect.arrayContaining(['deal.won', 'deal.lost', 'invoice.paid', 'quote.sent'])
    )
  })
})

describe('GET /api/webhooks/:id/deliveries', () => {
  it('returns this subscription’s delivery log', async () => {
    const subId = randomUUID()
    ;(store.tables['webhook_subscriptions'] as Row[]).push({
      id: subId,
      tenant_id: TENANT_ID,
      url: 'https://example.com/active',
      event_types: ['call.completed'],
      is_active: true,
    })
    ;(store.tables['webhook_deliveries'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      subscription_id: subId,
      event_type: 'call.completed',
      status: 'delivered',
      attempt_count: 1,
      response_status: 200,
    })
    const token = await makeToken()

    const res = await request(makeApp())
      .get(`/api/webhooks/${subId}/deliveries`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.deliveries).toHaveLength(1)
    expect(res.body.deliveries[0].status).toBe('delivered')
  })

  it('404s for a subscription belonging to another tenant', async () => {
    const subId = randomUUID()
    ;(store.tables['webhook_subscriptions'] as Row[]).push({
      id: subId,
      tenant_id: 'some-other-tenant',
      url: 'https://example.com/active',
      event_types: ['call.completed'],
      is_active: true,
    })
    const token = await makeToken()

    const res = await request(makeApp())
      .get(`/api/webhooks/${subId}/deliveries`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })
})

describe('API-key auth path', () => {
  it('accepts a valid, unrevoked API key via X-API-Key instead of a JWT', async () => {
    const { hashApiKey } = await import('../lib/api-key-auth.js')
    const rawKey = 'nuatis_test_key_123'
    ;(store.tables['api_keys'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      name: 'test key',
      key_hash: hashApiKey(rawKey),
      key_prefix: rawKey.slice(0, 14),
      revoked_at: null,
    })
    ;(store.tables['webhook_subscriptions'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      url: 'https://example.com/seeded',
      event_types: ['contact.created'],
      is_active: true,
    })

    const res = await request(makeApp()).get('/api/webhooks').set('X-API-Key', rawKey)

    expect(res.status).toBe(200)
    expect(res.body.subscriptions).toHaveLength(1)
  })

  it('rejects an unknown or revoked API key with 401', async () => {
    const res = await request(makeApp()).get('/api/webhooks').set('X-API-Key', 'nuatis_bogus')

    expect(res.status).toBe(401)
  })

  it('never returns another tenant’s subscriptions for a valid key', async () => {
    const { hashApiKey } = await import('../lib/api-key-auth.js')
    const rawKey = 'nuatis_test_key_456'
    ;(store.tables['api_keys'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      name: 'test key',
      key_hash: hashApiKey(rawKey),
      key_prefix: rawKey.slice(0, 14),
      revoked_at: null,
    })
    ;(store.tables['webhook_subscriptions'] as Row[]).push({
      id: randomUUID(),
      tenant_id: 'some-other-tenant',
      url: 'https://example.com/other-tenant',
      event_types: ['contact.created'],
      is_active: true,
    })

    const res = await request(makeApp()).get('/api/webhooks').set('X-API-Key', rawKey)

    expect(res.status).toBe(200)
    expect(res.body.subscriptions).toHaveLength(0)
  })
})
