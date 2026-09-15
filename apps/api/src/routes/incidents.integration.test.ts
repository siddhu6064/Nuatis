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

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000dsh0001'
const OTHER_TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000dsh0002'
const USER_ID = 'eeeeeeee-0000-0000-0000-00000user001'
const OTHER_USER_ID = 'eeeeeeee-0000-0000-0000-00000user002'
const INCIDENT_ID = 'ffffffff-0000-0000-0000-00000inc0001'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(): Promise<string> {
  return mintTestToken(
    { sub: USER_ID, appUserId: USER_ID, tenantId: TENANT_ID, role: 'owner' },
    { secret: SECRET }
  )
}

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: incidentsRouter } = await import('./incidents.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/incidents', incidentsRouter)
  return app
}

function incidentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: INCIDENT_ID,
    tenant_id: TENANT_ID,
    reference: 'INC-1001',
    type_key: 'wrong_item',
    severity: 'medium',
    status: 'open',
    title: 'Wrong side',
    cost_cents: 450,
    assigned_to_user_id: null,
    resolved_at: null,
    root_cause: null,
    created_at: '2026-09-15T10:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  store = createStore()
  seedEntitledTenant(store, TENANT_ID, { modules: { incidents: true } })
  store.tables['users'] = [
    { id: USER_ID, tenant_id: TENANT_ID, name: 'Dana' },
    { id: OTHER_USER_ID, tenant_id: OTHER_TENANT_ID, name: 'Someone else' },
  ]
  store.tables['incidents'] = [incidentRow()]
  store.tables['incident_events'] = []
  store.tables['incident_types'] = [
    {
      id: 'ty-1',
      tenant_id: TENANT_ID,
      key: 'wrong_item',
      label: 'Wrong item',
      default_severity: 'medium',
      requires_cost: false,
      deleted_at: null,
    },
  ]
})

describe('GET /api/incidents', () => {
  it("lists only the caller tenant's incidents", async () => {
    store.tables['incidents']!.push(
      incidentRow({ id: 'foreign', tenant_id: OTHER_TENANT_ID, reference: 'INC-9999' })
    )

    const res = await request(makeApp())
      .get('/api/incidents')
      .set('Authorization', `Bearer ${await makeToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].reference).toBe('INC-1001')
  })

  it('filters by status', async () => {
    store.tables['incidents']!.push(
      incidentRow({ id: 'done', status: 'resolved', reference: 'INC-1002' })
    )

    const res = await request(makeApp())
      .get('/api/incidents?status=resolved')
      .set('Authorization', `Bearer ${await makeToken()}`)

    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].reference).toBe('INC-1002')
  })

  it('filters by severity', async () => {
    store.tables['incidents']!.push(
      incidentRow({ id: 'crit', severity: 'critical', reference: 'INC-1003' })
    )

    const res = await request(makeApp())
      .get('/api/incidents?severity=critical')
      .set('Authorization', `Bearer ${await makeToken()}`)

    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].reference).toBe('INC-1003')
  })

  it('refuses a tenant without the incidents module', async () => {
    seedEntitledTenant(store, TENANT_ID, { modules: { incidents: false } })

    const res = await request(makeApp())
      .get('/api/incidents')
      .set('Authorization', `Bearer ${await makeToken()}`)

    expect(res.status).toBe(403)
  })
})

describe('PATCH /api/incidents/:id', () => {
  function patch(body: unknown, token: string) {
    return request(makeApp())
      .patch(`/api/incidents/${INCIDENT_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body as object)
  }

  it('assigns an incident and writes an event', async () => {
    const res = await patch({ assigned_to_user_id: USER_ID }, await makeToken())

    expect(res.status).toBe(200)
    expect(store.tables['incidents']![0]!['assigned_to_user_id']).toBe(USER_ID)
    expect(store.tables['incident_events']).toHaveLength(1)
    expect(store.tables['incident_events']![0]!['kind']).toBe('assigned')
  })

  it('rejects an assignee from another tenant', async () => {
    const res = await patch({ assigned_to_user_id: OTHER_USER_ID }, await makeToken())

    expect(res.status).toBe(400)
    expect(store.tables['incidents']![0]!['assigned_to_user_id']).toBeNull()
  })

  it('resolves with a root cause', async () => {
    const res = await patch(
      { status: 'resolved', root_cause: 'Kitchen misread the ticket' },
      await makeToken()
    )

    expect(res.status).toBe(200)
    expect(store.tables['incidents']![0]!['status']).toBe('resolved')
    expect(store.tables['incidents']![0]!['resolved_at']).toBeTruthy()
    expect(store.tables['incidents']![0]!['root_cause']).toBe('Kitchen misread the ticket')
  })

  it('refuses to reopen a resolved incident', async () => {
    store.tables['incidents'] = [incidentRow({ status: 'resolved' })]

    const res = await patch({ status: 'open' }, await makeToken())

    expect(res.status).toBe(400)
    expect(store.tables['incidents']![0]!['status']).toBe('resolved')
  })

  it('refuses a no-op transition so no empty event row is written', async () => {
    const res = await patch({ status: 'open' }, await makeToken())

    expect(res.status).toBe(400)
    expect(store.tables['incident_events']).toHaveLength(0)
  })

  it("404s for another tenant's incident and writes nothing", async () => {
    store.tables['incidents'] = [incidentRow({ tenant_id: OTHER_TENANT_ID })]

    const res = await patch({ status: 'triaged' }, await makeToken())

    expect(res.status).toBe(404)
    expect(store.tables['incidents']![0]!['status']).toBe('open')
    expect(store.tables['incident_events']).toHaveLength(0)
  })
})
