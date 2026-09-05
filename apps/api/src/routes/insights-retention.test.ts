import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
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

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000rt00001'
const USER_ID = 'user-rt-001'
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

function seedContact(id: string, createdAt: string): void {
  ;(store.tables['contacts'] as Row[]).push({
    id,
    tenant_id: TENANT_ID,
    created_at: createdAt,
  })
}

function seedActivity(contactId: string, createdAt: string): void {
  ;(store.tables['activity_log'] as Row[]).push({
    id: randomUUID(),
    tenant_id: TENANT_ID,
    contact_id: contactId,
    type: 'note',
    created_at: createdAt,
  })
}

beforeEach(() => {
  store = createStore()
  seedEntitledTenant(store, TENANT_ID)
  store.tables['contacts'] = []
  store.tables['activity_log'] = []
  jest.useFakeTimers().setSystemTime(new Date('2026-08-15T12:00:00.000Z'))
})

afterEach(() => {
  jest.useRealTimers()
})

describe('GET /api/insights/retention', () => {
  it('computes month-0 and month-1 retention for a cohort', async () => {
    // Cohort: 2 contacts created in June 2026.
    seedContact('c1', '2026-06-05T00:00:00.000Z')
    seedContact('c2', '2026-06-10T00:00:00.000Z')

    // Both active in their own cohort month (June).
    seedActivity('c1', '2026-06-06T00:00:00.000Z')
    seedActivity('c2', '2026-06-11T00:00:00.000Z')
    // Only c1 active the following month (July) -> 50% month-1 retention.
    seedActivity('c1', '2026-07-02T00:00:00.000Z')

    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/insights/retention?months=3')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const cohort = (
      res.body.cohorts as Array<{ cohort: string; size: number; retention: number[] }>
    ).find((c) => c.cohort === '2026-06')
    expect(cohort).toBeDefined()
    expect(cohort!.size).toBe(2)
    expect(cohort!.retention[0]).toBe(100)
    expect(cohort!.retention[1]).toBe(50)
  })

  it('does not count a contact active outside its own cohort window twice', async () => {
    seedContact('c1', '2026-06-05T00:00:00.000Z')
    seedActivity('c1', '2026-06-06T00:00:00.000Z')
    seedActivity('c1', '2026-06-20T00:00:00.000Z') // same month, same offset — should not double count

    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/insights/retention?months=3')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const cohort = (res.body.cohorts as Array<{ cohort: string; retention: number[] }>).find(
      (c) => c.cohort === '2026-06'
    )
    expect(cohort!.retention[0]).toBe(100)
  })

  it('returns null for a future offset month that has not happened yet for a recent cohort', async () => {
    // "Now" is 2026-08-15. A cohort from August has no month-1 data yet.
    seedContact('c1', '2026-08-01T00:00:00.000Z')
    seedActivity('c1', '2026-08-02T00:00:00.000Z')

    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/insights/retention?months=3')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const cohort = (
      res.body.cohorts as Array<{ cohort: string; retention: Array<number | null> }>
    ).find((c) => c.cohort === '2026-08')
    expect(cohort!.retention[0]).toBe(100)
    expect(cohort!.retention[1]).toBeNull()
  })

  it('returns an empty cohort list when the tenant has no contacts', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/insights/retention')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.cohorts).toEqual([])
  })

  it('does not include another tenant’s contacts in the cohort', async () => {
    seedContact('c1', '2026-06-05T00:00:00.000Z')
    ;(store.tables['contacts'] as Row[]).push({
      id: 'other-c1',
      tenant_id: 'other-tenant',
      created_at: '2026-06-05T00:00:00.000Z',
    })

    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/insights/retention?months=3')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const cohort = (res.body.cohorts as Array<{ cohort: string; size: number }>).find(
      (c) => c.cohort === '2026-06'
    )
    expect(cohort!.size).toBe(1)
  })
})
