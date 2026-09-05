import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { mintTestToken } from './__test-support__/jwt.js'
import { randomUUID } from 'node:crypto'
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

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000ir00001'
const USER_ID = 'user-ir-001'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(): Promise<string> {
  return mintTestToken({ sub: USER_ID, tenantId: TENANT_ID, role: 'owner' }, { secret: SECRET })
}

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: insightsRouter } = await import('./insights.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/insights', insightsRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  seedEntitledTenant(store, TENANT_ID)
  store.tables['contacts'] = []
  store.tables['appointments'] = []
  store.tables['customer_referral_rewards'] = []
})

describe('GET /api/insights/referrals', () => {
  it('counts link-based referrals (referred_by_contact_id) even without referral_source_detail', async () => {
    ;(store.tables['contacts'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      full_name: 'Link Referred',
      is_archived: false,
      referral_source_detail: null,
      referred_by_contact_id: randomUUID(),
    })

    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/insights/referrals')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.total_referred).toBe(1)
  })

  it('reports gift-card reward issuance counts from customer_referral_rewards', async () => {
    ;(store.tables['customer_referral_rewards'] as Row[]).push(
      { id: randomUUID(), tenant_id: TENANT_ID, status: 'issued' },
      { id: randomUUID(), tenant_id: TENANT_ID, status: 'issued' },
      { id: randomUUID(), tenant_id: TENANT_ID, status: 'pending' }
    )

    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/insights/referrals')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.rewards_issued).toBe(2)
    expect(res.body.rewards_pending).toBe(1)
  })
})
