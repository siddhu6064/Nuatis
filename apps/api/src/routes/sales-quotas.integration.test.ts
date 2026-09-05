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

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000sq00001'
const OTHER_TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000sq00099'
const REP_ID = 'user-sq-rep-1'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(role: string) {
  return mintTestToken(
    { sub: 'sub-1', appUserId: 'owner-1', tenantId: TENANT_ID, role },
    { secret: SECRET }
  )
}

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: salesQuotasRouter } = await import('./sales-quotas.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/sales-quotas', salesQuotasRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['users'] = [{ id: REP_ID, tenant_id: TENANT_ID, full_name: 'Rep One' }]
  store.tables['sales_quotas'] = []
})

describe('PUT /api/sales-quotas/:userId', () => {
  it('sets a quota for the given rep and month', async () => {
    const token = await makeToken('owner')
    const res = await request(makeApp())
      .put(`/api/sales-quotas/${REP_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ period_start: '2026-09', quota_amount: 5000 })

    expect(res.status).toBe(200)
    expect(res.body.user_id).toBe(REP_ID)
    expect(res.body.period_start).toBe('2026-09-01')
    expect(res.body.quota_amount).toBe(5000)
  })

  it('403s a non-owner/admin caller', async () => {
    const token = await makeToken('staff')
    const res = await request(makeApp())
      .put(`/api/sales-quotas/${REP_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ period_start: '2026-09', quota_amount: 5000 })

    expect(res.status).toBe(403)
  })

  it('404s a rep in another tenant', async () => {
    store.tables['users'] = [{ id: REP_ID, tenant_id: OTHER_TENANT_ID, full_name: 'Rep One' }]
    const token = await makeToken('owner')
    const res = await request(makeApp())
      .put(`/api/sales-quotas/${REP_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ period_start: '2026-09', quota_amount: 5000 })

    expect(res.status).toBe(404)
  })

  it('400s a negative quota_amount', async () => {
    const token = await makeToken('owner')
    const res = await request(makeApp())
      .put(`/api/sales-quotas/${REP_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ period_start: '2026-09', quota_amount: -1 })

    expect(res.status).toBe(400)
  })

  it('400s a missing period_start', async () => {
    const token = await makeToken('owner')
    const res = await request(makeApp())
      .put(`/api/sales-quotas/${REP_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ quota_amount: 5000 })

    expect(res.status).toBe(400)
  })
})

describe('GET /api/sales-quotas', () => {
  it('lists quotas for a given period, tenant-scoped', async () => {
    store.tables['sales_quotas'] = [
      {
        id: 'q-1',
        tenant_id: TENANT_ID,
        user_id: REP_ID,
        period_start: '2026-09-01',
        quota_amount: 5000,
      },
      {
        id: 'q-2',
        tenant_id: OTHER_TENANT_ID,
        user_id: 'other-rep',
        period_start: '2026-09-01',
        quota_amount: 9999,
      },
    ]
    const token = await makeToken('owner')
    const res = await request(makeApp())
      .get('/api/sales-quotas?period_start=2026-09')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.period_start).toBe('2026-09-01')
    expect(res.body.quotas).toHaveLength(1)
    expect(res.body.quotas[0].user_id).toBe(REP_ID)
  })
})
