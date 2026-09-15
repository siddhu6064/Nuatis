import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { mintTestToken } from './__test-support__/jwt.js'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from './__test-support__/supabase-mock.js'
import { seedEntitledTenant } from './__test-support__/tenant-fixture.js'

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000rpt0001'
const OTHER_TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000rpt0002'
const CASHIER_ID = 'dddddddd-0000-0000-0000-0000staff01'
const MANAGER_ID = 'dddddddd-0000-0000-0000-0000staff02'
const LOCATION_ID = 'bbbbbbbb-0000-0000-0000-00000loc0001'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(): Promise<string> {
  return mintTestToken(
    { sub: 'u1', appUserId: 'u1', tenantId: TENANT_ID, role: 'owner' },
    { secret: SECRET }
  )
}

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: reportsRouter } = await import('./incidents-reports.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/incidents/reports', reportsRouter)
  return app
}

async function summary(query = '') {
  return request(makeApp())
    .get(`/api/incidents/reports/summary${query}`)
    .set('Authorization', `Bearer ${await makeToken()}`)
}

/** An incident inside the default window (the current calendar month). */
function incident(overrides: Record<string, unknown> = {}) {
  const now = new Date()
  const inWindow = new Date(now.getFullYear(), now.getMonth(), 2, 12, 0, 0).toISOString()
  return {
    id: `inc-${Math.random().toString(36).slice(2, 9)}`,
    tenant_id: TENANT_ID,
    reference: 'INC-1001',
    type_key: 'wrong_item',
    severity: 'medium',
    status: 'open',
    cost_cents: 999,
    location_id: LOCATION_ID,
    reported_by_staff_id: CASHIER_ID,
    created_at: inWindow,
    ...overrides,
  }
}

beforeEach(() => {
  store = createStore()
  seedEntitledTenant(store, TENANT_ID, { modules: { incidents: true } })
  store.tables['staff_members'] = [
    { id: CASHIER_ID, tenant_id: TENANT_ID, name: 'Alex Brown' },
    { id: MANAGER_ID, tenant_id: TENANT_ID, name: 'Carlos Mendez' },
  ]
  store.tables['incident_types'] = [
    { id: 'ty-1', tenant_id: TENANT_ID, key: 'wrong_item', label: 'Wrong item', deleted_at: null },
    {
      id: 'ty-2',
      tenant_id: TENANT_ID,
      key: 'equipment',
      label: 'Equipment failure',
      deleted_at: null,
    },
  ]
  store.tables['incidents'] = []
})

describe('GET /api/incidents/reports/summary', () => {
  it('totals comps per staff member, which is what makes the threshold safe', async () => {
    // Six $9.99 comps from one cashier, every one below the $10 threshold and
    // each individually unremarkable.
    store.tables['incidents'] = Array.from({ length: 6 }, () => incident({ cost_cents: 999 }))

    const res = await summary()

    expect(res.status).toBe(200)
    const alex = res.body.byStaff.find((s: { staff_id: string }) => s.staff_id === CASHIER_ID)
    // Individually invisible, collectively $59.94.
    expect(alex.count).toBe(6)
    expect(alex.cost_cents).toBe(5994)
    expect(alex.staff_name).toBe('Alex Brown')
  })

  it('puts the biggest total first, so the outlier is row one', async () => {
    store.tables['incidents'] = [
      incident({ reported_by_staff_id: MANAGER_ID, cost_cents: 100 }),
      incident({ reported_by_staff_id: CASHIER_ID, cost_cents: 5000 }),
    ]

    const res = await summary()

    expect(res.body.byStaff[0].staff_id).toBe(CASHIER_ID)
  })

  it('groups by type_key, not label, so renaming a category does not change last month', async () => {
    store.tables['incidents'] = [incident({ cost_cents: 500 }), incident({ cost_cents: 700 })]
    // Someone renames the category after the fact.
    store.tables['incident_types']![0]!['label'] = 'Incorrect item'

    const res = await summary()

    expect(res.body.byType).toHaveLength(1)
    expect(res.body.byType[0].type_key).toBe('wrong_item')
    expect(res.body.byType[0].count).toBe(2)
    expect(res.body.byType[0].cost_cents).toBe(1200)
    // The label follows the rename; the grouping does not.
    expect(res.body.byType[0].label).toBe('Incorrect item')
  })

  it('still reports a type whose definition was deleted', async () => {
    // Deleting a category must not make last month's spend vanish.
    store.tables['incidents'] = [incident({ type_key: 'gone_away', cost_cents: 300 })]

    const res = await summary()

    const row = res.body.byType.find((t: { type_key: string }) => t.type_key === 'gone_away')
    expect(row.cost_cents).toBe(300)
    expect(row.label).toBe('gone_away')
  })

  it('counts a repeat as recurrence when the same type hits the same location', async () => {
    store.tables['incidents'] = Array.from({ length: 4 }, () =>
      incident({ type_key: 'equipment', cost_cents: 0 })
    )

    const res = await summary()

    expect(res.body.recurring).toHaveLength(1)
    expect(res.body.recurring[0].type_key).toBe('equipment')
    expect(res.body.recurring[0].location_id).toBe(LOCATION_ID)
    expect(res.body.recurring[0].count).toBe(4)
  })

  it('does not call two incidents a pattern', async () => {
    store.tables['incidents'] = [
      incident({ type_key: 'equipment' }),
      incident({ type_key: 'equipment' }),
    ]

    const res = await summary()

    expect(res.body.recurring).toHaveLength(0)
  })

  it('excludes cancelled incidents — one logged in error is not a cost', async () => {
    store.tables['incidents'] = [
      incident({ cost_cents: 1000 }),
      incident({ cost_cents: 9999, status: 'cancelled' }),
    ]

    const res = await summary()

    expect(res.body.byType[0].cost_cents).toBe(1000)
    expect(res.body.byStaff[0].cost_cents).toBe(1000)
  })

  it('excludes another tenant from every section', async () => {
    store.tables['incidents'] = [
      incident({ tenant_id: OTHER_TENANT_ID, cost_cents: 9999 }),
      incident({ tenant_id: OTHER_TENANT_ID, type_key: 'equipment' }),
      incident({ tenant_id: OTHER_TENANT_ID, type_key: 'equipment' }),
      incident({ tenant_id: OTHER_TENANT_ID, type_key: 'equipment' }),
    ]

    const res = await summary()

    expect(res.body.byType).toHaveLength(0)
    expect(res.body.byStaff).toHaveLength(0)
    expect(res.body.recurring).toHaveLength(0)
  })

  it('honours an explicit window', async () => {
    store.tables['incidents'] = [
      incident({ cost_cents: 100, created_at: '2026-01-15T12:00:00.000Z' }),
      incident({ cost_cents: 200, created_at: '2026-02-15T12:00:00.000Z' }),
    ]

    const res = await summary('?from=2026-01-01&to=2026-02-01')

    expect(res.body.byType).toHaveLength(1)
    expect(res.body.byType[0].cost_cents).toBe(100)
  })

  it('leaves an unattributed incident out of the per-staff table, not the totals', async () => {
    // A dashboard-reported incident has no staff member on it.
    store.tables['incidents'] = [
      incident({ cost_cents: 400, reported_by_staff_id: null }),
      incident({ cost_cents: 600 }),
    ]

    const res = await summary()

    expect(res.body.byType[0].cost_cents).toBe(1000)
    expect(res.body.byStaff).toHaveLength(1)
    expect(res.body.byStaff[0].cost_cents).toBe(600)
  })

  it('refuses a tenant without the incidents module', async () => {
    seedEntitledTenant(store, TENANT_ID, { modules: { incidents: false } })
    const res = await summary()
    expect(res.status).toBe(403)
  })
})
