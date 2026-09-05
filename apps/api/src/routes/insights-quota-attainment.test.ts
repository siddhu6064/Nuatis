import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { mintTestToken } from './__test-support__/jwt.js'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from './__test-support__/supabase-mock.js'
import { seedEntitledTenant } from './__test-support__/tenant-fixture.js'

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000qa00001'
const REP_A = 'user-qa-rep-a'
const REP_B = 'user-qa-rep-b'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(overrides: { sub: string; appUserId: string; role: string }) {
  return mintTestToken(
    { tenantId: TENANT_ID, vertical: 'dental', ...overrides },
    { secret: SECRET }
  )
}

const [{ default: express }, { default: request }, { default: insightsRouter }] = await Promise.all(
  [import('express'), import('supertest'), import('./insights.js')]
)

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/insights', insightsRouter)
  return app
}

const PERIOD = new Date()
const PERIOD_START = `${PERIOD.getFullYear()}-${String(PERIOD.getMonth() + 1).padStart(2, '0')}-01`

beforeEach(() => {
  store = createStore()
  seedEntitledTenant(store, TENANT_ID)
  store.tables['users'] = [
    { id: REP_A, tenant_id: TENANT_ID, full_name: 'Rep A', is_active: true },
    { id: REP_B, tenant_id: TENANT_ID, full_name: 'Rep B', is_active: true },
  ]
  store.tables['sales_quotas'] = [
    {
      id: 'q-1',
      tenant_id: TENANT_ID,
      user_id: REP_A,
      period_start: PERIOD_START,
      quota_amount: 1000,
    },
  ]
  store.tables['deals'] = [
    {
      id: 'd-1',
      tenant_id: TENANT_ID,
      value: 400,
      is_closed_won: true,
      assigned_to_user_id: REP_A,
      updated_at: new Date().toISOString(),
    },
  ]
})

describe('GET /api/insights/quota-attainment', () => {
  it('owner sees every rep with a quota, quota vs actual + attainment_pct', async () => {
    const token = await makeToken({ sub: 'sub-owner', appUserId: 'owner-1', role: 'owner' })

    const res = await request(makeApp())
      .get('/api/insights/quota-attainment')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const repA = res.body.reps.find((r: Row) => r['user_id'] === REP_A)
    expect(repA.quota_amount).toBe(1000)
    expect(repA.actual_amount).toBe(400)
    expect(repA.attainment_pct).toBe(40)
  })

  it('a non-manager only sees their own row, even though rep A has a quota', async () => {
    const token = await makeToken({ sub: 'sub-b', appUserId: REP_B, role: 'staff' })

    const res = await request(makeApp())
      .get('/api/insights/quota-attainment')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.reps).toHaveLength(1)
    expect(res.body.reps[0].user_id).toBe(REP_B)
    expect(res.body.reps[0].quota_amount).toBeNull()
    expect(res.body.reps[0].attainment_pct).toBeNull()
  })

  it('a rep with a quota but no closed-won deals this month shows actual_amount 0', async () => {
    store.tables['deals'] = []
    const token = await makeToken({ sub: 'sub-a', appUserId: REP_A, role: 'staff' })

    const res = await request(makeApp())
      .get('/api/insights/quota-attainment')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.reps[0].actual_amount).toBe(0)
    expect(res.body.reps[0].attainment_pct).toBe(0)
  })
})
