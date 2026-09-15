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

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000inc0001'
const OTHER_TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000inc0002'
const LOCATION_ID = 'bbbbbbbb-0000-0000-0000-00000loc0001'
const ORDER_ID = 'cccccccc-0000-0000-0000-00000ord0001'
const TICKET_ID = 'cccccccc-0000-0000-0000-00000tkt0001'
const CASHIER_ID = 'dddddddd-0000-0000-0000-0000staff01'
const MANAGER_ID = 'dddddddd-0000-0000-0000-0000staff02'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(): Promise<string> {
  return mintTestToken(
    { sub: 'user-inc-001', tenantId: TENANT_ID, role: 'owner', vertical: 'restaurant' },
    { secret: SECRET }
  )
}

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { hashPin } = await import('../../lib/pos-pin.js')
const { default: incidentsRouter } = await import('./incidents.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/pos/incidents', incidentsRouter)
  return app
}

function post(body: unknown, token: string) {
  return request(makeApp())
    .post('/api/pos/incidents')
    .set('Authorization', `Bearer ${token}`)
    .send(body as object)
}

beforeEach(async () => {
  store = createStore()
  seedEntitledTenant(store, TENANT_ID, { modules: { pos: true }, vertical: 'restaurant' })
  store.tables['locations'] = [{ id: LOCATION_ID, tenant_id: TENANT_ID, name: 'Demo Location' }]
  store.tables['orders'] = [
    { id: ORDER_ID, tenant_id: TENANT_ID, location_id: LOCATION_ID, order_number: 'ORD-1001' },
  ]
  store.tables['staff_members'] = [
    {
      id: CASHIER_ID,
      tenant_id: TENANT_ID,
      name: 'Alex Brown',
      role: 'Front of House',
      is_active: true,
      pos_can_authorise: false,
      pos_pin_hash: await hashPin('1234'),
    },
    {
      id: MANAGER_ID,
      tenant_id: TENANT_ID,
      name: 'Carlos Mendez',
      role: 'Head Chef',
      is_active: true,
      pos_can_authorise: true,
      pos_pin_hash: await hashPin('4321'),
    },
  ]
  store.tables['incident_types'] = [
    {
      id: 'ty-1',
      tenant_id: TENANT_ID,
      key: 'wrong_item',
      label: 'Wrong item',
      default_severity: 'medium',
      requires_cost: true,
      deleted_at: null,
    },
    {
      id: 'ty-2',
      tenant_id: TENANT_ID,
      key: 'complaint',
      label: 'Customer complaint',
      default_severity: 'medium',
      requires_cost: false,
      deleted_at: null,
    },
  ]
  store.tables['kitchen_tickets'] = [
    {
      id: TICKET_ID,
      tenant_id: TENANT_ID,
      location_id: LOCATION_ID,
      order_id: ORDER_ID,
      ticket_number: 1,
      status: 'queued',
    },
  ]
  store.tables['incidents'] = []
  store.tables['incident_events'] = []
})

describe('POST /api/pos/incidents', () => {
  it('records a small comp without a manager PIN', async () => {
    const res = await post(
      {
        type_key: 'wrong_item',
        title: 'Wrong side',
        cost_cents: 450,
        order_id: ORDER_ID,
        reported_by_staff_id: CASHIER_ID,
      },
      await makeToken()
    )
    expect(res.status).toBe(201)
    expect(store.tables['incidents']![0]!['cost_cents']).toBe(450)
    expect(store.tables['incidents']![0]!['authorised_by_staff_id']).toBeNull()
  })

  it('refuses a comp at or above the threshold with no manager PIN', async () => {
    const res = await post(
      {
        type_key: 'wrong_item',
        title: 'Whole order',
        cost_cents: 1350,
        order_id: ORDER_ID,
        reported_by_staff_id: CASHIER_ID,
      },
      await makeToken()
    )
    expect(res.status).toBe(403)
    expect(store.tables['incidents']).toHaveLength(0)
  })

  it('treats the threshold itself as needing a manager, not just above it', async () => {
    const res = await post(
      {
        type_key: 'wrong_item',
        title: 'Exactly ten dollars',
        cost_cents: 1000,
        reported_by_staff_id: CASHIER_ID,
      },
      await makeToken()
    )
    expect(res.status).toBe(403)
  })

  it('accepts it with a manager PIN and records who authorised', async () => {
    const res = await post(
      {
        type_key: 'wrong_item',
        title: 'Whole order',
        cost_cents: 1350,
        order_id: ORDER_ID,
        reported_by_staff_id: CASHIER_ID,
        manager_pin: '4321',
      },
      await makeToken()
    )
    expect(res.status).toBe(201)
    expect(store.tables['incidents']![0]!['authorised_by_staff_id']).toBe(MANAGER_ID)
  })

  it('refuses a valid PIN belonging to someone without the authorise flag', async () => {
    // role is free-text job titles in this schema, so authorisation is an
    // explicit pos_can_authorise flag. A cashier's own PIN must not work.
    const res = await post(
      {
        type_key: 'wrong_item',
        title: 'Whole order',
        cost_cents: 1350,
        reported_by_staff_id: CASHIER_ID,
        manager_pin: '1234',
      },
      await makeToken()
    )
    expect(res.status).toBe(403)
    expect(store.tables['incidents']).toHaveLength(0)
  })

  it('refuses a deactivated manager', async () => {
    store.tables['staff_members']![1]!['is_active'] = false
    const res = await post(
      {
        type_key: 'wrong_item',
        title: 'Whole order',
        cost_cents: 1350,
        reported_by_staff_id: CASHIER_ID,
        manager_pin: '4321',
      },
      await makeToken()
    )
    expect(res.status).toBe(403)
  })

  it("refuses another tenant's manager PIN", async () => {
    store.tables['staff_members']![1]!['tenant_id'] = OTHER_TENANT_ID
    const res = await post(
      {
        type_key: 'wrong_item',
        title: 'Whole order',
        cost_cents: 1350,
        reported_by_staff_id: CASHIER_ID,
        manager_pin: '4321',
      },
      await makeToken()
    )
    expect(res.status).toBe(403)
  })

  it('never prompts for a zero-cost report', async () => {
    const res = await post(
      {
        type_key: 'complaint',
        title: 'Customer complained',
        cost_cents: 0,
        reported_by_staff_id: CASHIER_ID,
      },
      await makeToken()
    )
    expect(res.status).toBe(201)
  })

  it('enforces requires_cost — wastage with no amount understates food cost', async () => {
    const res = await post(
      {
        type_key: 'wrong_item',
        title: 'Dropped a plate',
        cost_cents: 0,
        reported_by_staff_id: CASHIER_ID,
      },
      await makeToken()
    )
    expect(res.status).toBe(400)
  })

  it('rejects an order belonging to another tenant', async () => {
    store.tables['orders']!.push({
      id: 'foreign-order',
      tenant_id: OTHER_TENANT_ID,
      location_id: LOCATION_ID,
    })
    const res = await post(
      {
        type_key: 'complaint',
        title: 'x',
        cost_cents: 0,
        order_id: 'foreign-order',
        reported_by_staff_id: CASHIER_ID,
      },
      await makeToken()
    )
    expect(res.status).toBe(400)
    expect(store.tables['incidents']).toHaveLength(0)
  })

  it('rejects a type_key the tenant does not have', async () => {
    const res = await post(
      { type_key: 'not_a_type', title: 'x', cost_cents: 0, reported_by_staff_id: CASHIER_ID },
      await makeToken()
    )
    expect(res.status).toBe(400)
  })

  it('rejects a negative cost', async () => {
    const res = await post(
      {
        type_key: 'complaint',
        title: 'x',
        cost_cents: -100,
        reported_by_staff_id: CASHIER_ID,
      },
      await makeToken()
    )
    expect(res.status).toBe(400)
  })

  it('writes an opening event so the timeline starts at creation', async () => {
    await post(
      { type_key: 'complaint', title: 'x', cost_cents: 0, reported_by_staff_id: CASHIER_ID },
      await makeToken()
    )
    expect(store.tables['incident_events']).toHaveLength(1)
    expect(store.tables['incident_events']![0]!['kind']).toBe('reported')
  })

  it('stamps an sla_due_at from the type default severity', async () => {
    await post(
      { type_key: 'complaint', title: 'x', cost_cents: 0, reported_by_staff_id: CASHIER_ID },
      await makeToken()
    )
    expect(store.tables['incidents']![0]!['sla_due_at']).toBeTruthy()
  })

  it('inherits the location from the ticket, so it is not lost from reporting', async () => {
    // The KDS deliberately sends no location — a client-chosen one is how an
    // incident gets filed against the wrong site. The server must take it from
    // the ticket, or the incident has no location at all and drops out of
    // location-scoped reporting and recurrence.
    const res = await post(
      {
        type_key: 'complaint',
        title: 'Remake',
        cost_cents: 0,
        kitchen_ticket_id: TICKET_ID,
        reported_by_staff_id: CASHIER_ID,
      },
      await makeToken()
    )

    expect(res.status).toBe(201)
    expect(store.tables['incidents']![0]!['location_id']).toBe(LOCATION_ID)
  })

  it('ignores a client-supplied location on a ticket-linked report', async () => {
    // The ticket is the authority. A register sending a different location —
    // by bug or otherwise — must not override it.
    const res = await post(
      {
        type_key: 'complaint',
        title: 'Remake',
        cost_cents: 0,
        kitchen_ticket_id: TICKET_ID,
        location_id: 'bbbbbbbb-0000-0000-0000-0000wrongloc',
        reported_by_staff_id: CASHIER_ID,
      },
      await makeToken()
    )

    expect(res.status).toBe(201)
    expect(store.tables['incidents']![0]!['location_id']).toBe(LOCATION_ID)
  })

  it('refuses a tenant without the POS module', async () => {
    seedEntitledTenant(store, TENANT_ID, { modules: { pos: false }, vertical: 'restaurant' })
    const res = await post(
      { type_key: 'complaint', title: 'x', cost_cents: 0, reported_by_staff_id: CASHIER_ID },
      await makeToken()
    )
    expect(res.status).toBe(403)
  })
})
