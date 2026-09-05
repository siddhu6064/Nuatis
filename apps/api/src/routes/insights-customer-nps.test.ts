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

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000cn00001'
const USER_ID = 'user-cn-001'
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

function seedResponse(score: number, respondedAt: string): void {
  ;(store.tables['nps_responses'] as Row[]).push({
    id: randomUUID(),
    tenant_id: TENANT_ID,
    contact_id: null,
    status: 'responded',
    score,
    comment: null,
    responded_at: respondedAt,
  })
}

beforeEach(() => {
  store = createStore()
  seedEntitledTenant(store, TENANT_ID)
  store.tables['nps_responses'] = []
})

describe('GET /api/insights/customer-nps', () => {
  it('computes the standard NPS formula from responded rows only', async () => {
    // 2 promoters (9,10), 1 passive (7), 1 detractor (3) => (2-1)/4 * 100 = 25
    seedResponse(9, '2026-08-01T00:00:00.000Z')
    seedResponse(10, '2026-08-02T00:00:00.000Z')
    seedResponse(7, '2026-08-03T00:00:00.000Z')
    seedResponse(3, '2026-08-04T00:00:00.000Z')
    // a pending (not yet responded) row must not affect the math
    ;(store.tables['nps_responses'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      status: 'sent',
      score: null,
    })

    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/insights/customer-nps')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.summary.response_count).toBe(4)
    expect(res.body.summary.promoters).toBe(2)
    expect(res.body.summary.passives).toBe(1)
    expect(res.body.summary.detractors).toBe(1)
    expect(res.body.summary.nps_score).toBe(25)
    expect(res.body.summary.avg_score).toBeCloseTo(7.25, 1)
  })

  it('returns a zeroed summary when there are no responses', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/insights/customer-nps')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.summary.response_count).toBe(0)
    expect(res.body.summary.nps_score).toBe(0)
    expect(res.body.recent_responses).toEqual([])
  })
})
