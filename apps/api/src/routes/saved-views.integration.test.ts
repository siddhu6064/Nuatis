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

// Both tenantId and userId must be valid UUIDs — the handler short-circuits
// to { views: [] } otherwise (guard against non-UUID dev tokens).
const TENANT_ID = '550e8400-e29b-41d4-a716-446655440000'
const USER_ID = '550e8400-e29b-41d4-a716-446655440001'
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

const [{ default: express }, { default: request }, { default: savedViewsRouter }] =
  await Promise.all([import('express'), import('supertest'), import('./saved-views.js')])

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/views', savedViewsRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['saved_views'] = []
})

describe('POST /api/views', () => {
  it('creates saved view and returns 201 with id', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/views')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Hot Leads',
        filters: { lead_score_min: 70 },
        object_type: 'contacts',
      })

    expect(res.status).toBe(201)
    expect(res.body.id).toBeDefined()
    expect(res.body.name).toBe('Hot Leads')
  })

  it('returns 400 when name is missing', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/views')
      .set('Authorization', `Bearer ${token}`)
      .send({ filters: {} })

    expect(res.status).toBe(400)
  })
})

describe('GET /api/views', () => {
  it('returns views array for authenticated user', async () => {
    ;(store.tables['saved_views'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      user_id: USER_ID,
      name: 'My View',
      object_type: 'contacts',
      filters: {},
      sort_order: 0,
      created_at: new Date().toISOString(),
    })
    const token = await makeToken()

    const res = await request(makeApp()).get('/api/views').set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.views)).toBe(true)
    expect(res.body.views.length).toBeGreaterThanOrEqual(1)
  })
})
