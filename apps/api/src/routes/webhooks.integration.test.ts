import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { SignJWT } from 'jose'
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
  const secretBytes = new TextEncoder().encode(SECRET)
  return new SignJWT({ sub: USER_ID, tenantId: TENANT_ID, role: 'owner', vertical: 'dental' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secretBytes)
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
