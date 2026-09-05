import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { mintTestToken } from './__test-support__/jwt.js'
import { randomUUID } from 'node:crypto'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from './__test-support__/supabase-mock.js'
import { entitledTenantRow } from './__test-support__/tenant-fixture.js'

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000pc00001'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(): Promise<string> {
  return mintTestToken({ sub: 'user-1', tenantId: TENANT_ID, role: 'owner' }, { secret: SECRET })
}

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: promoCodesRouter } = await import('./promo-codes.js')

function makeApp() {
  const app = express()
  app.use('/api/promo-codes', express.json(), promoCodesRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = [entitledTenantRow(TENANT_ID)]
  store.tables['promo_codes'] = []
})

describe('POST /api/promo-codes', () => {
  it('creates a code, uppercasing it', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/promo-codes')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'summer20', discount_type: 'percent', discount_value: 20 })

    expect(res.status).toBe(201)
    expect(res.body.code).toBe('SUMMER20')
    expect(res.body.active).toBe(true)
    expect(res.body.redemption_count).toBe(0)
  })

  // The 409-on-duplicate-code behavior is enforced by the DB-level unique
  // index (tenant_id, upper(code)) in migration 0148, not application code —
  // supabase-mock.ts doesn't simulate unique-constraint violations, so it
  // can't be represented against this mock (same class of limitation as
  // other unique-index-backed guarantees built this session).

  it('400s on a percent value over 100', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/promo-codes')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'TOOBIG', discount_type: 'percent', discount_value: 150 })
    expect(res.status).toBe(400)
  })

  it('400s without a code', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/promo-codes')
      .set('Authorization', `Bearer ${token}`)
      .send({ discount_type: 'percent', discount_value: 10 })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/promo-codes/lookup/:code', () => {
  it('resolves an active code, case-insensitively', async () => {
    store.tables['promo_codes']!.push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      code: 'WELCOME10',
      discount_type: 'percent',
      discount_value: 10,
      active: true,
    })
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/promo-codes/lookup/welcome10')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.discount_type).toBe('percent')
    expect(res.body.discount_value).toBe(10)
  })

  it('404s for an unknown code', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/promo-codes/lookup/NOPE')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/promo-codes/:id', () => {
  it('deactivates a code', async () => {
    const id = randomUUID()
    store.tables['promo_codes']!.push({
      id,
      tenant_id: TENANT_ID,
      code: 'DEACTIVATEME',
      discount_type: 'fixed',
      discount_value: 5,
      active: true,
    })
    const token = await makeToken()
    const res = await request(makeApp())
      .patch(`/api/promo-codes/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ active: false })

    expect(res.status).toBe(200)
    expect(res.body.active).toBe(false)
  })

  it('404s for a code belonging to another tenant', async () => {
    const id = randomUUID()
    store.tables['promo_codes']!.push({
      id,
      tenant_id: 'other-tenant',
      code: 'NOTMINE',
      discount_type: 'fixed',
      discount_value: 5,
      active: true,
    })
    const token = await makeToken()
    const res = await request(makeApp())
      .patch(`/api/promo-codes/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ active: false })

    expect(res.status).toBe(404)
  })
})

describe('GET /api/promo-codes', () => {
  it('401s without auth', async () => {
    const res = await request(makeApp()).get('/api/promo-codes')
    expect(res.status).toBe(401)
  })

  it('lists codes for the tenant', async () => {
    store.tables['promo_codes']!.push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      code: 'A',
      discount_type: 'fixed',
      discount_value: 5,
      active: true,
    })
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/promo-codes')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data as Row[]).toHaveLength(1)
  })
})
