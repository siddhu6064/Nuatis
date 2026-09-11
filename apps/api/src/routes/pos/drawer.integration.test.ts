import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { mintTestToken } from '../__test-support__/jwt.js'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from '../__test-support__/supabase-mock.js'
import { seedEntitledTenant } from '../__test-support__/tenant-fixture.js'

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000drw0001'
const OTHER_TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000drw0002'
const LOCATION_ID = 'bbbbbbbb-0000-0000-0000-00000loc0001'
const USER_ID = 'user-drw-001'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(): Promise<string> {
  return mintTestToken(
    { sub: USER_ID, tenantId: TENANT_ID, role: 'owner', vertical: 'restaurant' },
    { secret: SECRET }
  )
}

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: drawerRouter } = await import('./drawer.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/pos/drawer', drawerRouter)
  return app
}

function openSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sess-1',
    tenant_id: TENANT_ID,
    location_id: LOCATION_ID,
    opening_float: '100.00',
    closed_at: null,
    ...overrides,
  }
}

beforeEach(() => {
  store = createStore()
  seedEntitledTenant(store, TENANT_ID, { modules: { pos: true } })
  store.tables['cash_drawer_sessions'] = []
  store.tables['cash_events'] = []
})

describe('POST /api/pos/drawer/sessions', () => {
  it('opens a session with an opening float', async () => {
    const res = await request(makeApp())
      .post('/api/pos/drawer/sessions')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ location_id: LOCATION_ID, opening_float: 150.0 })

    expect(res.status).toBe(201)
    expect(res.body.session.location_id).toBe(LOCATION_ID)
    expect(res.body.session.closed_at).toBeFalsy()
  })

  it('refuses to open a second drawer at the same location', async () => {
    store.tables['cash_drawer_sessions'] = [openSession()]

    const res = await request(makeApp())
      .post('/api/pos/drawer/sessions')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ location_id: LOCATION_ID, opening_float: 150.0 })

    expect(res.status).toBe(409)
  })

  it('allows opening when the previous session at that location is closed', async () => {
    store.tables['cash_drawer_sessions'] = [openSession({ closed_at: '2026-09-10T02:00:00Z' })]

    const res = await request(makeApp())
      .post('/api/pos/drawer/sessions')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ location_id: LOCATION_ID, opening_float: 150.0 })

    expect(res.status).toBe(201)
  })

  it('is not blocked by another tenant’s open drawer at a colliding location id', async () => {
    store.tables['cash_drawer_sessions'] = [openSession({ tenant_id: OTHER_TENANT_ID })]

    const res = await request(makeApp())
      .post('/api/pos/drawer/sessions')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ location_id: LOCATION_ID, opening_float: 150.0 })

    expect(res.status).toBe(201)
  })

  it('requires a location_id', async () => {
    const res = await request(makeApp())
      .post('/api/pos/drawer/sessions')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ opening_float: 150.0 })

    expect(res.status).toBe(400)
  })

  it('rejects a negative opening float', async () => {
    const res = await request(makeApp())
      .post('/api/pos/drawer/sessions')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ location_id: LOCATION_ID, opening_float: -5 })

    expect(res.status).toBe(400)
  })
})

describe('GET /api/pos/drawer/sessions/current', () => {
  it('returns the open session for the location', async () => {
    store.tables['cash_drawer_sessions'] = [openSession()]

    const res = await request(makeApp())
      .get(`/api/pos/drawer/sessions/current?location_id=${LOCATION_ID}`)
      .set('Authorization', `Bearer ${await makeToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.session.id).toBe('sess-1')
  })

  it('returns null when no drawer is open', async () => {
    const res = await request(makeApp())
      .get(`/api/pos/drawer/sessions/current?location_id=${LOCATION_ID}`)
      .set('Authorization', `Bearer ${await makeToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.session).toBeNull()
  })

  it('requires a location_id', async () => {
    const res = await request(makeApp())
      .get('/api/pos/drawer/sessions/current')
      .set('Authorization', `Bearer ${await makeToken()}`)

    expect(res.status).toBe(400)
  })
})

describe('POST /api/pos/drawer/sessions/:id/events', () => {
  beforeEach(() => {
    store.tables['cash_drawer_sessions'] = [openSession()]
  })

  it('records a sale event', async () => {
    const res = await request(makeApp())
      .post('/api/pos/drawer/sessions/sess-1/events')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ type: 'sale', amount: 25.5 })

    expect(res.status).toBe(201)
    expect(store.tables['cash_events']).toHaveLength(1)
  })

  it('rejects a negative amount — direction comes from type, not sign', async () => {
    const res = await request(makeApp())
      .post('/api/pos/drawer/sessions/sess-1/events')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ type: 'paid_out', amount: -20 })

    expect(res.status).toBe(400)
  })

  it('rejects an unknown event type', async () => {
    const res = await request(makeApp())
      .post('/api/pos/drawer/sessions/sess-1/events')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ type: 'skim', amount: 20 })

    expect(res.status).toBe(400)
  })

  it('refuses to record against a closed session', async () => {
    store.tables['cash_drawer_sessions'] = [openSession({ closed_at: '2026-09-10T02:00:00Z' })]

    const res = await request(makeApp())
      .post('/api/pos/drawer/sessions/sess-1/events')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ type: 'sale', amount: 25.5 })

    expect(res.status).toBe(409)
  })

  it('404s for another tenant’s session', async () => {
    store.tables['cash_drawer_sessions'] = [openSession({ tenant_id: OTHER_TENANT_ID })]

    const res = await request(makeApp())
      .post('/api/pos/drawer/sessions/sess-1/events')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ type: 'sale', amount: 25.5 })

    expect(res.status).toBe(404)
    expect(store.tables['cash_events']).toHaveLength(0)
  })
})

describe('POST /api/pos/drawer/sessions/:id/close', () => {
  beforeEach(() => {
    store.tables['cash_drawer_sessions'] = [openSession()]
    store.tables['cash_events'] = [
      { id: 'e1', tenant_id: TENANT_ID, session_id: 'sess-1', type: 'sale', amount: '50.00' },
      { id: 'e2', tenant_id: TENANT_ID, session_id: 'sess-1', type: 'refund', amount: '10.00' },
      { id: 'e3', tenant_id: TENANT_ID, session_id: 'sess-1', type: 'paid_out', amount: '5.00' },
      { id: 'e4', tenant_id: TENANT_ID, session_id: 'sess-1', type: 'paid_in', amount: '20.00' },
    ]
  })

  it('computes expected total from float plus signed event sum', async () => {
    // 100 + 50 sale - 10 refund - 5 paid_out + 20 paid_in = 155.00
    const res = await request(makeApp())
      .post('/api/pos/drawer/sessions/sess-1/close')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ counted_total: 155.0 })

    expect(res.status).toBe(200)
    expect(res.body.session.expected_total).toBe('155.00')
    expect(res.body.session.variance).toBe('0.00')
  })

  it('reports a short drawer as a negative variance', async () => {
    const res = await request(makeApp())
      .post('/api/pos/drawer/sessions/sess-1/close')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ counted_total: 150.0 })

    expect(res.status).toBe(200)
    expect(res.body.session.variance).toBe('-5.00')
  })

  it('reports an over drawer as a positive variance', async () => {
    const res = await request(makeApp())
      .post('/api/pos/drawer/sessions/sess-1/close')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ counted_total: 157.25 })

    expect(res.status).toBe(200)
    expect(res.body.session.variance).toBe('2.25')
  })

  it('excludes events belonging to another session', async () => {
    store.tables['cash_events']!.push({
      id: 'e-other',
      tenant_id: TENANT_ID,
      session_id: 'sess-elsewhere',
      type: 'sale',
      amount: '999.00',
    })

    const res = await request(makeApp())
      .post('/api/pos/drawer/sessions/sess-1/close')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ counted_total: 155.0 })

    expect(res.status).toBe(200)
    expect(res.body.session.expected_total).toBe('155.00')
  })

  it('does not drift on amounts that are awkward in binary floating point', async () => {
    store.tables['cash_drawer_sessions'] = [openSession({ opening_float: '0.00' })]
    store.tables['cash_events'] = [
      { id: 'f1', tenant_id: TENANT_ID, session_id: 'sess-1', type: 'sale', amount: '0.10' },
      { id: 'f2', tenant_id: TENANT_ID, session_id: 'sess-1', type: 'sale', amount: '0.20' },
      { id: 'f3', tenant_id: TENANT_ID, session_id: 'sess-1', type: 'sale', amount: '8.285' },
    ]

    const res = await request(makeApp())
      .post('/api/pos/drawer/sessions/sess-1/close')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ counted_total: 8.59 })

    expect(res.status).toBe(200)
    // 0.10 + 0.20 + 8.285 → 10 + 20 + 829 cents = 859
    expect(res.body.session.expected_total).toBe('8.59')
    expect(res.body.session.variance).toBe('0.00')
  })

  it('requires counted_total', async () => {
    const res = await request(makeApp())
      .post('/api/pos/drawer/sessions/sess-1/close')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({})

    expect(res.status).toBe(400)
  })

  it('refuses to close an already-closed session', async () => {
    store.tables['cash_drawer_sessions'] = [openSession({ closed_at: '2026-09-10T02:00:00Z' })]

    const res = await request(makeApp())
      .post('/api/pos/drawer/sessions/sess-1/close')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ counted_total: 155.0 })

    expect(res.status).toBe(409)
  })

  it('404s for another tenant’s session', async () => {
    store.tables['cash_drawer_sessions'] = [openSession({ tenant_id: OTHER_TENANT_ID })]

    const res = await request(makeApp())
      .post('/api/pos/drawer/sessions/sess-1/close')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ counted_total: 155.0 })

    expect(res.status).toBe(404)
  })
})
